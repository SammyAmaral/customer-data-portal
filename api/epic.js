/* =========================================================================
   /api/epic?key=DOD-#### — one engagement's full status report.

   THE ACCESS GATE: a signed-in user gets this Epic only if they are internal
   or the Epic is in their allow-list. Anything else is a hard 403 — a shared
   link cannot leak another customer's report, because the check is here on the
   server, not in the browser.

   Feed "1st Sample Sent" / "Sample Approved" dates come from the real Jira date
   fields (cf_13588 / cf_13589); we still pull each feed's status-change history
   as a fallback for older feeds where those fields were never filled in.
   ========================================================================= */
import { getUserScope, requireJira, fetchIssue, fetchIssues } from './_access.js';
import {
  EPIC_DETAIL_FIELDS, FEED_FIELDS, CF, firstLink, cleanText, parseZyteId, mapEpicDetail, mapFeed, derivePhase, PHASES,
} from './_map.js';
import { getSowPricing, domainKey } from './sow.js';
import { enrichFeeds } from './scrapy.js';
import { loadOpenTickets, freshdeskCount, freshdeskConfigured } from './freshdesk.js';

export default async function handler(req, res) {
  const scope = await getUserScope(req);
  if (!scope.ok) { res.status(scope.status).json({ error: scope.error }); return; }
  if (!requireJira(res)) return;

  const key = String((req.query && req.query.key) || '').toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) {
    res.status(400).json({ error: 'A valid Epic key is required, e.g. ?key=DOD-14209.' });
    return;
  }

  // Authorization — the whole point of the app.
  if (!scope.internal && !scope.epicKeys.has(key)) {
    res.status(403).json({ error: 'You do not have access to this report.' });
    return;
  }

  try {
    const epic = await fetchIssue(key, { fields: EPIC_DETAIL_FIELDS });
    if (!epic || !epic.fields) { res.status(404).json({ error: 'Engagement not found.' }); return; }

    // Domain-level crawling components + tasks (tasks feed the phase stepper).
    const children = await fetchIssues({
      jql: `parent = ${key} AND issuetype in ("Crawling-Component","Task","Handover") ORDER BY created ASC`,
      fields: [...FEED_FIELDS, 'parent'],
    });
    const domainsRaw = children.filter((c) => c.fields && c.fields.issuetype && c.fields.issuetype.name === 'Crawling-Component');
    const tasks = children.filter((c) => c.fields && c.fields.issuetype && c.fields.issuetype.name === 'Task');

    // Sub-crawlers: the Jira SUB-TASKS of each domain component (one level below
    // the Epic). Each sub-task carries its own Spider Name (cf_14219). One
    // batched query covers every domain.
    let subsRaw = [];
    if (domainsRaw.length) {
      try {
        subsRaw = await fetchIssues({
          jql: `parent in (${domainsRaw.map((d) => d.key).join(',')}) AND issuetype = "Sub-task" ORDER BY created ASC`,
          fields: [...FEED_FIELDS, 'parent'],
        });
      } catch { subsRaw = []; }
    }

    // Map every component. Sample dates come from the real cf_13588/cf_13589
    // fields inside mapFeed, so no per-feed changelog fetch is needed.
    const asOf = new Date().toISOString();
    const feeds = domainsRaw.map((d) => mapFeed(d, [], asOf));
    const subFeeds = subsRaw.map((s) => {
      const f = mapFeed(s, [], asOf);
      f.parentKey = (s.fields.parent && s.fields.parent.key) || null;
      return f;
    });

    // Gap-fill missing per-feed prices from the SOW (best-effort; never throws).
    let sowStatus = null;
    if (feeds.some((f) => f.subscriptionPrice == null)) {
      const sowUrl = firstLink(epic.fields[CF.sows]) || firstLink(epic.fields.description);
      try {
        const sow = await getSowPricing(key, sowUrl);
        sowStatus = sow.status;
        if (sow.ok) {
          for (const f of feeds) {
            if (f.subscriptionPrice != null) continue;
            const hit = sow.byDomain[domainKey(f.name)];
            if (hit && hit.subscriptionFee != null) {
              f.subscriptionPrice = hit.subscriptionFee;
              f.priceSource = 'sow';
            }
          }
        }
      } catch { sowStatus = 'error'; }
    }

    // Enrich feeds with live Scrapy Cloud crawl telemetry (best-effort).
    // The Epic points at its production + development Scrapy Cloud projects;
    // each feed's spider is looked up there (see api/scrapy.js).
    let scrapyStatus = null;
    let scrapyDebug = null;
    try {
      const sc = await enrichFeeds(key, feeds.concat(subFeeds), {
        prodProject: parseZyteId(epic.fields[CF.scProdProject], 'p'),
        devProject: parseZyteId(epic.fields[CF.scDevProject], 'p'),
        org: parseZyteId(epic.fields[CF.zyteDataOrg], 'o'),
      });
      scrapyStatus = sc.status;
      scrapyDebug = sc.debug || null;
    } catch (e) { scrapyStatus = 'error'; }

    // Group sub-crawlers under their domain component and roll up telemetry, so
    // the domain card + report show aggregate items / errors / health.
    if (subFeeds.length) {
      const itemsOf = (s) => (s.deliveredItems != null ? s.deliveredItems : (s.records != null ? s.records : 0));
      const isUnhealthy = (s) => s.jobState && !s.jobHealthy;
      for (const d of feeds) {
        const subs = subFeeds.filter((s) => s.parentKey === d.key);
        if (!subs.length) continue;
        d.subCrawlers = subs;
        d.subCounts = { total: subs.length, healthy: subs.filter((s) => s.jobState && s.jobHealthy).length, attention: subs.filter(isUnhealthy).length };
        d.deliveredItems = null; d.deliveredPhase = null;  // domain shows the rolled-up total, not a container's own job
        d.records = subs.reduce((n, s) => n + itemsOf(s), 0);
        d.recordsRecent = subs.reduce((n, s) => n + (s.recordsRecent || 0), 0);
        d.jobErrors = subs.reduce((n, s) => n + (s.jobErrors || 0), 0);
        d.jobErrorsRecent = subs.reduce((n, s) => n + (s.jobErrorsRecent || 0), 0);
        d.jobHealthy = !subs.some(isUnhealthy);
        d.jobState = subs.some((s) => s.jobState === 'running' || s.jobState === 'pending') ? 'running'
          : (subs.some((s) => s.jobState) ? 'finished' : d.jobState);
        d.jobFinished = subs.map((s) => s.jobFinished).filter(Boolean).sort().slice(-1)[0] || d.jobFinished;
      }
    }

    // Freshdesk: open support tickets linked to this engagement (best-effort).
    // Engagement link = "Zyte Data Org Comms" (cf_13577/13560) matched against
    // the ticket custom field; per-domain tickets also counted by domain/key.
    let support = { open: 0, configured: freshdeskConfigured };
    try {
      const fdTickets = await loadOpenTickets();
      if (fdTickets) {
        const commsKey = cleanText(epic.fields[CF.dataOrgComms]) || cleanText(epic.fields[CF.dataOrgComms2]) || null;
        const fdId = cleanText(epic.fields[CF.freshdeskId]) || null;
        const candidates = [commsKey, fdId, key, ...feeds.map((f) => f.key), ...feeds.map((f) => f.name)];
        support = { open: freshdeskCount(fdTickets, candidates, feeds.map((f) => f.name)), configured: true };
      }
      if (scope.internal) { const u = firstLink(epic.fields[CF.freshdeskUrl]); if (u) support.url = u; }
    } catch { /* best-effort */ }

    const kickoffDone = tasks.some((t) =>
      /kickoff|solution design/i.test((t.fields.summary) || '') &&
      /done|complete|closed/i.test(t.fields.status ? t.fields.status.name : ''));
    const phaseIndex = derivePhase(feeds.map((f) => f.status), kickoffDone);

    const detail = mapEpicDetail(epic, { internal: scope.internal });
    detail.webUrl = epic.self ? `https://zyte.atlassian.net/browse/${key}` : null;
    detail.feeds = feeds;
    detail.feedCount = feeds.length;
    detail.phase = { index: phaseIndex, steps: PHASES };
    detail.sowPricingStatus = sowStatus;
    detail.scrapyStatus = scrapyStatus;
    detail.support = support;
    // The technical config + crawl alerts/diagnostics are internal-only.
    if (scope.internal) detail.scrapyDebug = scrapyDebug;
    else for (const f of feeds) {
      delete f.config; delete f.alerts; delete f.renderPct; delete f.responses; delete f.blocked;
      delete f.subCrawlers;   // per-sub-crawler internals stay internal; customers keep the rolled-up totals
      // Internal Scrapy Cloud identifiers/links — customers keep the item COUNTS
      // (records / sampleItems / fullItems / deliveredItems) but not the job keys.
      delete f.jobKey; delete f.jobUrl; delete f.jobProject;
      delete f.sampleJobKey; delete f.fullJobKey; delete f.sampleJobUrl; delete f.fullJobUrl;
      delete f.deliveredJobKey; delete f.scJobKey; delete f.scProject;
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(detail);
  } catch (err) {
    res.status(502).json({ error: 'Failed to pull from Jira.', detail: String(err.message || err) });
  }
}
