/* =========================================================================
   scrapy.js — live crawl telemetry from Scrapy Cloud.

   Resolution model (per the DOD setup):
     • The Epic stores its Scrapy Cloud PRODUCTION and DEVELOPMENT project ids
       ("Scrapycloud Production/Development Project", cf_14254/14255) plus the
       data org ("Zyte Data Org", cf_13556).
     • Each feed (Crawling-Component) carries its Spider Name (cf_14219). If that
       field is empty we derive the spider from the site domain in the summary
       (e.g. "…- smartandfinal.com" → "smartandfinal_com").
     • For each feed we look the spider up in the production project first, then
       the development project, and pull its recent jobs.

   Jobs API (app.zyte.com): GET /api/jobs/list.json?project={id}&spider={name}
   — HTTP Basic auth, API key as the username with an empty password. Each job:
   items_scraped, errors_count, state, close_reason, started_time, updated_time.
   Spiders run per-store, so a spider has many jobs: we take the latest for
   state/health and sum recent runs for volume. Best-effort with graceful
   fallback + [scrapy] logs; results cached hourly in Supabase.
   ========================================================================= */
import { createClient } from '@supabase/supabase-js';
import { deriveSpiderName } from './_map.js';

const SC_KEY = process.env.SCRAPYCLOUD_API_KEY || '';
const SC_BASE = (process.env.SCRAPYCLOUD_BASE || 'https://app.zyte.com').replace(/\/+$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CACHE_TTL_MS = 60 * 60 * 1000; // crawl telemetry refreshes hourly
const MAX_FEEDS = 60;                // bound external calls per report
const JOBS_PER_SPIDER = 20;          // recent-runs window we aggregate over

export const scrapyConfigured = Boolean(SC_KEY);

const svc = (SUPABASE_URL && SUPABASE_SERVICE)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { persistSession: false } })
  : null;

function authHeader() {
  return 'Basic ' + Buffer.from(`${SC_KEY}:`).toString('base64');
}

const ms = (t) => { const n = Date.parse(t); return Number.isFinite(n) ? n : 0; };
const dateStr = (t) => (t ? String(t).slice(0, 10) : null);

// org → its projects, cached per warm instance. Used only when the Epic has no
// explicit production/development project set (falls back to the data org).
const ORG_PROJECTS = new Map();
async function orgProjects(org) {
  if (ORG_PROJECTS.has(org)) return ORG_PROJECTS.get(org);
  const url = `${SC_BASE}/api/v2/projects?organization=${encodeURIComponent(org)}&show=all&page_size=10000`;
  let list = [];
  try {
    const resp = await fetch(url, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
    if (resp.ok) {
      const body = await resp.json();
      // SECURITY: this payload also carries customer API keys in `settings` —
      // only ever read id/name/last_activity, and never log the raw response.
      list = (Array.isArray(body && body.results) ? body.results : [])
        .filter((p) => p && !p.deleted)
        .map((p) => ({ id: p.id, name: String(p.name || ''), lastActivity: p.last_activity || '' }));
    } else { console.warn('[scrapy] projects', resp.status, org); }
  } catch (e) { console.warn('[scrapy] projects', org, String((e && e.message) || e)); }
  ORG_PROJECTS.set(org, list);
  return list;
}

// Rank an org's projects to the production/development candidates to search,
// most-recently-active first, capped so we never fan out over an entire org.
function rankProjects(projects) {
  const recent = (a, b) => ms(b.lastActivity) - ms(a.lastActivity);
  const prod = projects.filter((p) => /prod/i.test(p.name)).sort(recent).map((p) => ({ ...p, env: 'prod' }));
  const dev = projects.filter((p) => /dev/i.test(p.name)).sort(recent).map((p) => ({ ...p, env: 'dev' }));
  const seen = new Set();
  const ordered = [];
  for (const p of [...prod, ...dev]) { if (!seen.has(p.id)) { seen.add(p.id); ordered.push(p); } }
  return ordered.slice(0, 6);
}

// Recent jobs for one spider in one project. Returns [] on no jobs, null on error.
// `probe` accumulates HTTP outcomes so we can surface why nothing came back.
async function fetchSpiderJobs(project, spider, probe) {
  const url = `${SC_BASE}/api/jobs/list.json?project=${encodeURIComponent(project)}`
    + `&spider=${encodeURIComponent(spider)}&count=${JOBS_PER_SPIDER}`;
  probe.calls++;
  const resp = await fetch(url, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
  if (!resp.ok) {
    probe.status[resp.status] = (probe.status[resp.status] || 0) + 1;
    console.warn('[scrapy] jobs.list', resp.status, project, spider);
    return null;
  }
  probe.ok++;
  let body;
  try { body = await resp.json(); } catch { return null; }
  const jobs = Array.isArray(body && body.jobs) ? body.jobs : [];
  // The API filters by spider, but verify defensively so we never mis-attribute.
  return jobs.filter((j) => j && (!spider || j.spider === spider));
}

// Collapse a spider's recent jobs into the telemetry we surface.
function summarize(jobs, project, env) {
  if (!jobs || !jobs.length) return null;
  const sorted = [...jobs].sort((a, b) => ms(b.started_time) - ms(a.started_time));
  const latest = sorted[0];
  const latestFinished = sorted.find((j) => j.state === 'finished') || latest;
  const state = latest.state || null;
  const closeReason = latest.close_reason || null;
  const healthy = state === 'running' || state === 'pending'
    ? true
    : state === 'finished' && (!closeReason || closeReason === 'finished');
  return {
    records: Number(latestFinished.items_scraped) || 0,       // items in the latest crawl
    recordsRecent: sorted.reduce((s, j) => s + (Number(j.items_scraped) || 0), 0),
    runs: sorted.length,
    state,
    closeReason,
    errors: Number(latest.errors_count) || 0,
    errorsRecent: sorted.reduce((s, j) => s + (Number(j.errors_count) || 0), 0),
    finished: dateStr(latest.updated_time),
    healthy,
    source: env,          // 'prod' | 'dev'
    project,
    jobKey: latest.id || null,
  };
}

function apply(feed, s) {
  feed.records = s.records;
  feed.recordsRecent = s.recordsRecent;
  feed.jobRuns = s.runs;
  feed.jobState = s.state;
  feed.jobCloseReason = s.closeReason;
  feed.jobErrors = s.errors;
  feed.jobErrorsRecent = s.errorsRecent;
  feed.jobFinished = s.finished;
  feed.jobHealthy = !!s.healthy;
  feed.jobSource = s.source;                 // 'prod' | 'dev'
  feed.jobProject = s.project;
  feed.jobKey = s.jobKey;
  feed.jobUrl = s.jobKey ? `https://app.zyte.com/p/${s.jobKey}`
    : (s.project ? `https://app.zyte.com/p/${s.project}` : null);
}

// Attach crawl telemetry to each feed. scConfig = { prodProject, devProject }.
// Mutates feeds in place; returns a short status for diagnostics.
export async function enrichFeeds(epicKey, feeds, scConfig = {}) {
  if (!scrapyConfigured) return { status: 'not-configured', enriched: 0 };

  // Prefer the explicit prod/dev project fields on the Epic; otherwise fall
  // back to listing the data org and picking its prod/dev projects by name.
  let projects = [
    { id: scConfig.prodProject, env: 'prod' },
    { id: scConfig.devProject, env: 'dev' },
  ].filter((p) => p.id);
  let via = 'epic-projects';
  if (!projects.length && scConfig.org) {
    projects = rankProjects(await orgProjects(scConfig.org));
    via = 'org-listing';
  }
  if (!projects.length) return { status: scConfig.org ? 'no-projects-in-org' : 'no-projects', enriched: 0 };

  // Resolve each feed's spider (explicit field, else derived from the domain).
  const targets = [];
  for (const f of feeds) {
    const spider = f.spiderName || deriveSpiderName(f.name);
    if (spider) { f.spiderResolved = spider; targets.push(f); }
    if (targets.length >= MAX_FEEDS) break;
  }
  if (!targets.length) return { status: 'no-spiders', enriched: 0 };

  const cacheKey = (f) => `${epicKey}:${f.key}`;
  const cache = {};
  if (svc) {
    try {
      const { data } = await svc.from('scrapy_jobs')
        .select('key, data, fetched_at').in('key', targets.map(cacheKey));
      for (const row of data || []) {
        if (row.data && Date.now() - new Date(row.fetched_at).getTime() < CACHE_TTL_MS) cache[row.key] = row.data;
      }
    } catch { /* table absent or pre-migration schema → fetch fresh */ }
  }

  let enriched = 0;
  const toCache = [];
  const probe = { calls: 0, ok: 0, status: {} }; // HTTP outcomes for diagnostics
  await Promise.all(targets.map(async (f) => {
    const k = cacheKey(f);
    if (cache[k]) { apply(f, cache[k]); enriched++; return; }
    try {
      let summary = null;
      for (const p of projects) {          // production first, then development
        const jobs = await fetchSpiderJobs(p.id, f.spiderResolved, probe);
        if (jobs && jobs.length) { summary = summarize(jobs, p.id, p.env); break; }
      }
      if (summary) {
        apply(f, summary);
        enriched++;
        toCache.push({ key: k, epic_key: epicKey, spider: f.spiderResolved, data: summary, fetched_at: new Date().toISOString() });
      }
    } catch (e) { console.warn('[scrapy] feed', f.key, String((e && e.message) || e)); }
  }));

  if (svc && toCache.length) {
    try { await svc.from('scrapy_jobs').upsert(toCache, { onConflict: 'key' }); } catch { /* best-effort */ }
  }
  // Summarise the HTTP outcomes so the UI can say *why* nothing came back:
  // an auth code (401/403) = the key was rejected; all-OK-but-no-jobs = the
  // spider names don't match a deployed spider.
  const httpErrors = Object.entries(probe.status).map(([code, n]) => `${code}×${n}`).join(' ');
  const authRejected = !!(probe.status[401] || probe.status[403]);
  const debug = {
    projects: projects.map((p) => `${p.env}:${p.id}`),
    via, spiders: targets.length, enriched,
    jobCalls: probe.calls, jobCallsOk: probe.ok, httpErrors: httpErrors || null, authRejected,
  };
  console.log('[scrapy]', epicKey, 'via', via, 'projects', debug.projects.join(','),
    'spiders', targets.length, 'enriched', enriched, 'jobCalls', probe.calls, 'ok', probe.ok,
    'httpErrors', httpErrors || 'none');
  return { status: enriched ? 'ok' : 'no-jobs', enriched, debug };
}
