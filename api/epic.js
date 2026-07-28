/* =========================================================================
   /api/epic?key=DOD-#### — one engagement's full status report.

   THE ACCESS GATE: a signed-in user gets this Epic only if they are internal
   or the Epic is in their allow-list. Anything else is a hard 403 — a shared
   link cannot leak another customer's report, because the check is here on the
   server, not in the browser.

   Feed "1st Sample Sent" / "Sample Approved" dates are derived from each
   crawling-component's status-change history (the dedicated date custom-fields
   are empty on DOD), so we pull each feed's changelog.
   ========================================================================= */
import { getUserScope, requireJira, fetchIssue, fetchIssues } from './_access.js';
import {
  EPIC_DETAIL_FIELDS, FEED_FIELDS, CF, firstLink, mapEpicDetail, mapFeed, derivePhase, PHASES,
} from './_map.js';
import { getSowPricing, domainKey } from './sow.js';
import { enrichFeeds } from './scrapy.js';

const MAX_CHANGELOG_FEEDS = 80; // safety cap on per-feed changelog fetches

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

    // Children: crawling-component feeds + tasks (for the phase stepper).
    const children = await fetchIssues({
      jql: `parent = ${key} AND issuetype in ("Crawling-Component","Task","Handover") ORDER BY created ASC`,
      fields: [...FEED_FIELDS, 'parent'],
    });
    const feedsRaw = children.filter((c) => c.fields && c.fields.issuetype && c.fields.issuetype.name === 'Crawling-Component');
    const tasks = children.filter((c) => c.fields && c.fields.issuetype && c.fields.issuetype.name === 'Task');

    // Per-feed changelog → sample dates (best-effort, bounded, parallel).
    const asOf = new Date().toISOString();
    const capped = feedsRaw.slice(0, MAX_CHANGELOG_FEEDS);
    const histories = await Promise.all(capped.map(async (feed) => {
      try {
        const full = await fetchIssue(feed.key, { fields: ['status'], expand: 'changelog' });
        return (full && full.changelog && full.changelog.histories) || [];
      } catch { return []; }
    }));
    const feeds = capped.map((feed, i) => mapFeed(feed, histories[i], asOf));
    // Any feeds beyond the cap still appear, just without derived sample dates.
    for (const feed of feedsRaw.slice(MAX_CHANGELOG_FEEDS)) feeds.push(mapFeed(feed, [], asOf));

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
    let scrapyStatus = null;
    try {
      const sc = await enrichFeeds(key, feeds);
      scrapyStatus = sc.status;
    } catch (e) { scrapyStatus = 'error'; }

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

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(detail);
  } catch (err) {
    res.status(502).json({ error: 'Failed to pull from Jira.', detail: String(err.message || err) });
  }
}
