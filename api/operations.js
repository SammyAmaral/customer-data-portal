/* =========================================================================
   /api/operations — cross-engagement OPERATIONAL view of in-production
   crawlers ("project → operations").

   Every domain (a Crawling-Component) whose Jira status category is Done
   appears here with a live traffic-light health, the same Scrapy Cloud
   telemetry as the Technical view, and a (mocked) Freshdesk open-ticket flag.
   Internal-only.

   Data path — there is no project-wide crawler query elsewhere, and Scrapy
   project ids are per-Epic, so we: (1) one JQL for Done crawling-components
   across DOD, (2) resolve each one's parent Epic (Scrapy projects + customer),
   (3) pull each domain's sub-crawlers, (4) enrich grouped BY EPIC, (5) roll up
   + compute health. Bounded + reuses the hourly scrapy_jobs cache.
   ========================================================================= */
import { getUserScope, requireJira, fetchIssues, PROJECT } from './_access.js';
import { CF, FEED_FIELDS, mapFeed, parseZyteId, customerName } from './_map.js';
import { enrichFeeds } from './scrapy.js';

const MAX_CRAWLERS = 250; // safety bound on how many Done crawlers we enrich

const itemsOf = (u) => (u.deliveredItems != null ? u.deliveredItems : (u.records != null ? u.records : 0));
const isUnhealthy = (u) => u.jobState && !u.jobHealthy;
const hasAlert = (u) => Array.isArray(u.alerts) && u.alerts.some((a) => a && (a.level === 'high' || a.level === 'warn'));
const isZero = (u) => u.jobState === 'finished' && itemsOf(u) === 0;

// Traffic light. grey = no telemetry yet (not "down"); red = producing nothing;
// green = every reporting unit healthy, no alerts; amber = anything in between.
function healthOf(units) {
  const known = units.filter((u) => u.jobState);
  if (!known.length) return 'grey';
  const producing = known.reduce((n, u) => n + itemsOf(u), 0) > 0;
  if (!producing) return 'red';
  if (known.every((u) => u.jobHealthy) && !known.some(hasAlert) && !known.some(isZero)) return 'green';
  return 'amber';
}

// Deterministic mock Freshdesk ticket (no RNG). Swap the body for the real
// Freshdesk API later; the shape stays the same.
function hash(s) { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const FD_PRIORITY = ['Low', 'Medium', 'High', 'Urgent'];
const FD_SUBJECTS = ['Missing fields in latest delivery', 'Fewer items than expected', 'Anti-bot blocks on recent runs', 'Schema change flagged by customer', 'Delivery delayed / stale data'];
function mockFreshdesk(key, health) {
  const h = hash(key);
  const open = health === 'green' ? (h % 8 === 0) : (h % 3 !== 0);
  if (!open) return { open: false };
  return { open: true, id: 40000 + (h % 9000), priority: health === 'red' ? 'Urgent' : FD_PRIORITY[h % 4], subject: FD_SUBJECTS[h % FD_SUBJECTS.length] };
}

export default async function handler(req, res) {
  const scope = await getUserScope(req);
  if (!scope.ok) { res.status(scope.status).json({ error: scope.error }); return; }
  if (!scope.internal) { res.status(403).json({ error: 'Operation Status is internal-only.' }); return; }
  if (!requireJira(res)) return;

  const asOf = new Date().toISOString();
  try {
    // 1. Every Done crawling-component across the DOD project.
    let doneRaw = await fetchIssues({
      jql: `project = "${PROJECT}" AND issuetype = "Crawling-Component" AND statusCategory = Done ORDER BY updated DESC`,
      fields: [...FEED_FIELDS, 'parent'],
    });
    const truncated = doneRaw.length > MAX_CRAWLERS;
    doneRaw = doneRaw.slice(0, MAX_CRAWLERS);
    if (!doneRaw.length) { res.status(200).json({ ok: true, checkedAt: asOf, crawlers: [] }); return; }

    // 2. Resolve parent Epics (Scrapy config + customer). A Done component whose
    //    parent is an Epic is a domain row; others are Done sub-crawlers (skip).
    const parentKeys = [...new Set(doneRaw.map((c) => c.fields.parent && c.fields.parent.key).filter(Boolean))];
    const parents = parentKeys.length ? await fetchIssues({
      jql: `key in (${parentKeys.join(',')})`,
      fields: ['summary', 'issuetype', CF.customer, CF.scProdProject, CF.scDevProject, CF.zyteDataOrg],
    }) : [];
    const epicCfg = new Map();
    for (const p of parents) {
      if (!(p.fields && p.fields.issuetype && p.fields.issuetype.name === 'Epic')) continue;
      epicCfg.set(p.key, {
        customer: customerName(p),
        prodProject: parseZyteId(p.fields[CF.scProdProject], 'p'),
        devProject: parseZyteId(p.fields[CF.scDevProject], 'p'),
        org: parseZyteId(p.fields[CF.zyteDataOrg], 'o'),
      });
    }
    const domainsRaw = doneRaw.filter((c) => c.fields.parent && epicCfg.has(c.fields.parent.key));
    if (!domainsRaw.length) { res.status(200).json({ ok: true, checkedAt: asOf, crawlers: [], truncated }); return; }

    // 3. Sub-crawlers of those domains (any status) for the health roll-up.
    const domainKeys = domainsRaw.map((d) => d.key);
    const subsRaw = [];
    for (let i = 0; i < domainKeys.length; i += 60) {
      const chunk = domainKeys.slice(i, i + 60);
      try {
        const part = await fetchIssues({
          jql: `parent in (${chunk.join(',')}) AND issuetype = "Crawling-Component" ORDER BY created ASC`,
          fields: [...FEED_FIELDS, 'parent'],
        });
        subsRaw.push(...part);
      } catch { /* ignore this chunk */ }
    }

    // 4. Map + group each domain (and its subs) by parent Epic; enrich per Epic.
    const domains = domainsRaw.map((d) => { const f = mapFeed(d, [], asOf); f.epicKey = d.fields.parent.key; return f; });
    const subFeeds = subsRaw.map((s) => { const f = mapFeed(s, [], asOf); f.parentDomainKey = (s.fields.parent && s.fields.parent.key) || null; return f; });
    const domainByKey = new Map(domains.map((d) => [d.key, d]));

    const byEpic = new Map();
    const pushEpic = (epicKey, f) => { const g = byEpic.get(epicKey); if (g) g.push(f); else byEpic.set(epicKey, [f]); };
    for (const d of domains) pushEpic(d.epicKey, d);
    for (const s of subFeeds) { const dom = domainByKey.get(s.parentDomainKey); if (dom) pushEpic(dom.epicKey, s); }

    await Promise.all([...byEpic.entries()].map(([epicKey, groupFeeds]) => {
      const cfg = epicCfg.get(epicKey) || {};
      return enrichFeeds(epicKey, groupFeeds, { prodProject: cfg.prodProject, devProject: cfg.devProject, org: cfg.org }).catch(() => {});
    }));

    // 5. Roll up subs onto domains + compute health + Freshdesk mock.
    const crawlers = domains.map((d) => {
      const subs = subFeeds.filter((s) => s.parentDomainKey === d.key);
      const units = subs.length ? subs : [d];
      let subCounts = null;
      let records = d.records != null ? d.records : null;
      let recordsRecent = d.recordsRecent != null ? d.recordsRecent : null;
      let jobErrors = d.jobErrors != null ? d.jobErrors : null;
      let jobHealthy = !!d.jobHealthy;
      let jobFinished = d.jobFinished || null;
      if (subs.length) {
        subCounts = { total: subs.length, healthy: subs.filter((s) => s.jobState && s.jobHealthy).length, attention: subs.filter(isUnhealthy).length };
        records = subs.reduce((n, s) => n + itemsOf(s), 0);
        recordsRecent = subs.reduce((n, s) => n + (s.recordsRecent || 0), 0);
        jobErrors = subs.reduce((n, s) => n + (s.jobErrors || 0), 0);
        jobHealthy = !subs.some(isUnhealthy);
        jobFinished = subs.map((s) => s.jobFinished).filter(Boolean).sort().slice(-1)[0] || jobFinished;
      }
      const health = healthOf(units);
      const cfg = epicCfg.get(d.epicKey) || {};
      const alerts = units.reduce((n, u) => n + ((u.alerts && u.alerts.length) || 0), 0);
      return {
        key: d.key, name: d.name, customer: cfg.customer || '—', epicKey: d.epicKey,
        status: d.status, statusCategory: d.statusCategory, health,
        records, recordsRecent, jobErrors, jobState: d.jobState || null, jobHealthy, jobFinished,
        subCounts, series: d.series || null, alerts,
        freshdesk: mockFreshdesk(d.key, health),
      };
    });

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.status(200).json({ ok: true, checkedAt: asOf, truncated, crawlers });
  } catch (err) {
    res.status(502).json({ error: 'Failed to build the operations view.', detail: String((err && err.message) || err) });
  }
}
