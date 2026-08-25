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

   Jobs come from the HubStorage API (storage.scrapinghub.com), which is built
   for programmatic API-key access — HTTP Basic auth, API key as the username,
   empty password. GET /jobq/{project}/list?spider={name}&count=N returns recent
   jobs (JSON lines) with items, errors, state, close_reason, timestamps.
   (The app.zyte.com/api/jobs/list.json route is browser-facing and 503s behind
   Cloudflare for server-side calls, so we don't use it.) Spiders run per-store,
   so a spider has many jobs: we take the latest for state/health and sum recent
   runs for volume. Best-effort + [scrapy] logs; results cached hourly.
   ========================================================================= */
import { createClient } from '@supabase/supabase-js';
import { deriveSpiderName } from './_map.js';

const SC_KEY = process.env.SCRAPYCLOUD_API_KEY || '';
const SC_BASE = (process.env.SCRAPYCLOUD_BASE || 'https://storage.scrapinghub.com').replace(/\/+$/, '');
// The org→projects listing lives on the app host (used only by the org fallback).
const SC_APP_BASE = (process.env.SCRAPYCLOUD_APP_BASE || 'https://app.zyte.com').replace(/\/+$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CACHE_TTL_MS = 60 * 60 * 1000; // crawl telemetry refreshes hourly
const MAX_FEEDS = 150;               // bound external calls per report (domains + sub-crawlers)
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
  const url = `${SC_APP_BASE}/api/v2/projects?organization=${encodeURIComponent(org)}&show=all&page_size=10000`;
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

// Normalize a HubStorage jobq record to the shape summarize() expects.
// jobq times are epoch-ms numbers; item/error counts are `items`/`errors`.
function normalizeJob(j) {
  const start = j.running_time || j.ts || null;
  const end = j.finished_time || j.ts || null;
  return {
    spider: j.spider || null,
    state: j.state || null,
    close_reason: j.close_reason || null,
    items_scraped: Number(j.items) || 0,
    errors_count: Number(j.errors) || 0,
    started_time: start ? new Date(start).toISOString() : null,
    updated_time: end ? new Date(end).toISOString() : null,
    id: j.key || null,
  };
}

// Recent jobs for one spider in one project, from HubStorage's jobq (JSON lines).
// Returns [] on no jobs, null on error. `probe` accumulates HTTP outcomes.
async function fetchSpiderJobs(project, spider, probe) {
  const url = `${SC_BASE}/jobq/${encodeURIComponent(project)}/list`
    + `?spider=${encodeURIComponent(spider)}&count=${JOBS_PER_SPIDER}`;
  probe.calls++;
  const resp = await fetch(url, { headers: { Authorization: authHeader() } });
  if (!resp.ok) {
    probe.status[resp.status] = (probe.status[resp.status] || 0) + 1;
    console.warn('[scrapy] jobq', resp.status, project, spider);
    return null;
  }
  probe.ok++;
  const text = await resp.text();
  const jobs = text.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(normalizeJob);
  // Verify the spider defensively so we never mis-attribute a job.
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
    series: sorted.slice(0, 8).map((j) => Number(j.items_scraped) || 0).reverse(), // recent-run trend (old→new)
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

// The full Scrapy stats dict for a job (status-code counts, retries, Zyte API
// request types…) from HubStorage job metadata. Best-effort; null on any miss.
async function fetchJobStats(jobKey, probe) {
  if (!jobKey) return null;
  const resp = await fetch(`${SC_BASE}/jobs/${jobKey}?format=json`, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
  probe.statCalls = (probe.statCalls || 0) + 1;
  if (!resp.ok) { probe.status[resp.status] = (probe.status[resp.status] || 0) + 1; return null; }
  let body;
  try { body = await resp.json(); } catch { return null; }
  const stats = (body && (body.scrapystats || body.stats)) || null;
  if (stats) {
    // Log the alert-relevant keys once so the exact names can be confirmed live.
    console.log('[scrapy] statkeys', jobKey, Object.keys(stats)
      .filter((k) => /status_count|zyte-api|retry|item_scraped|response_count|finish_reason|browserhtml|httpresponsebody/i.test(k))
      .slice(0, 40).join(','));
  }
  return stats;
}

const BAN_CODES = [403, 429, 503, 407];
const statNum = (o, k) => Number(o && o[k]) || 0;

// Derive alert chips from a job's summary + Scrapy stats. level: high | warn.
function computeAlerts(summary, stats) {
  const alerts = [];
  const { state, closeReason: cr } = summary;

  if (state === 'finished' && cr && cr !== 'finished') {
    alerts.push({ level: 'high', code: 'job', label: `job: ${cr}` });
  } else if (state && state !== 'finished' && state !== 'running' && state !== 'pending') {
    alerts.push({ level: 'high', code: 'job', label: `job: ${state}` });
  }

  let responses = null; let blocked = 0; let renderPct = null;
  if (stats) {
    responses = statNum(stats, 'downloader/response_count') || statNum(stats, 'response_received_count') || null;
    blocked = BAN_CODES.reduce((s, c) => s + statNum(stats, `downloader/response_status_count/${c}`), 0);
    if (blocked > 0) {
      const pct = responses ? Math.round((blocked / responses) * 100) : null;
      alerts.push({ level: pct != null && pct >= 5 ? 'high' : 'warn', code: 'ban', label: pct != null ? `${blocked} blocked · ${pct}%` : `${blocked} blocked (403/429)` });
    }
    // Browser-render vs raw-request usage (Zyte API request types).
    let render = statNum(stats, 'scrapy-zyte-api/request_args/browserHtml') + statNum(stats, 'scrapy-zyte-api/request_args/screenshot');
    let raw = statNum(stats, 'scrapy-zyte-api/request_args/httpResponseBody');
    if (render + raw === 0) {
      for (const [k, v] of Object.entries(stats)) {
        if (/browserhtml|screenshot/i.test(k)) render += Number(v) || 0;
        else if (/httpresponsebody/i.test(k)) raw += Number(v) || 0;
      }
    }
    const totalReq = render + raw;
    if (totalReq > 0) {
      renderPct = Math.round((render / totalReq) * 100);
      if (renderPct > 20) alerts.push({ level: 'warn', code: 'render', label: `browser render · ${renderPct}%` });
    }
  }

  if (state === 'finished' && summary.records === 0 && (responses == null || responses > 0)) {
    alerts.push({ level: 'high', code: 'items', label: responses ? `0 items · ${responses} responses` : '0 items' });
  }

  return { alerts, responses, blocked, renderPct };
}

// Item count + finish info for one exact job, from its Scrapy stats dict.
function jobDelivery(jobKey, stats) {
  if (!stats) return { jobKey, items: null, finished: null };
  return { jobKey, items: Number(stats.item_scraped_count) || 0, finished: dateStr(stats.finish_time) };
}

// The DELIVERED datasets: item counts from the exact Jira-linked SAMPLE
// (cf_14251) and FULL-crawl (cf_14250) jobs. `deliveredItems` follows the
// phase — the full crawl once the customer has approved the sample, else the
// sample. Works off the explicit job keys, so it needs no project resolution.
async function fetchDelivered(feed, probe) {
  const d = {};
  if (feed.sampleJobKey) {
    const st = await fetchJobStats(feed.sampleJobKey, probe).catch(() => null);
    const j = jobDelivery(feed.sampleJobKey, st);
    d.sampleItems = j.items; d.sampleFinished = j.finished;
  }
  if (feed.fullJobKey) {
    const st = await fetchJobStats(feed.fullJobKey, probe).catch(() => null);
    const j = jobDelivery(feed.fullJobKey, st);
    d.fullItems = j.items; d.fullFinished = j.finished;
  }
  const approved = !!feed.sampleApproved;
  if (approved && d.fullItems != null) { d.deliveredPhase = 'full'; d.deliveredItems = d.fullItems; d.deliveredJobKey = feed.fullJobKey; d.deliveredFinished = d.fullFinished; }
  else if (d.sampleItems != null) { d.deliveredPhase = 'sample'; d.deliveredItems = d.sampleItems; d.deliveredJobKey = feed.sampleJobKey; d.deliveredFinished = d.sampleFinished; }
  else if (d.fullItems != null) { d.deliveredPhase = 'full'; d.deliveredItems = d.fullItems; d.deliveredJobKey = feed.fullJobKey; d.deliveredFinished = d.fullFinished; }
  return d;
}

// Merge a telemetry blob onto a feed. Every field is guarded so a delivered-
// only feed (Jira links but no resolvable spider) isn't blanked out.
function apply(feed, s) {
  if (!s) return;
  if (s.records != null) feed.records = s.records;
  if (s.alerts) feed.alerts = s.alerts;
  if ('responses' in s) feed.responses = s.responses != null ? s.responses : null;
  if ('renderPct' in s) feed.renderPct = s.renderPct != null ? s.renderPct : null;
  if ('blocked' in s) feed.blocked = s.blocked || 0;
  if (s.recordsRecent != null) feed.recordsRecent = s.recordsRecent;
  if (s.series) feed.series = s.series;
  if (s.runs != null) { feed.jobRuns = s.runs; feed.crawlAttempts = s.runs; }
  if ('state' in s) feed.jobState = s.state;
  if ('closeReason' in s) feed.jobCloseReason = s.closeReason;
  if (s.errors != null) feed.jobErrors = s.errors;
  if (s.errorsRecent != null) feed.jobErrorsRecent = s.errorsRecent;
  if ('finished' in s) feed.jobFinished = s.finished;
  if ('healthy' in s) feed.jobHealthy = !!s.healthy;
  if ('source' in s) feed.jobSource = s.source;             // 'prod' | 'dev'
  if ('project' in s) feed.jobProject = s.project;
  if ('jobKey' in s) {
    feed.jobKey = s.jobKey;
    feed.jobUrl = s.jobKey ? `https://app.zyte.com/p/${s.jobKey}`
      : (s.project ? `https://app.zyte.com/p/${s.project}` : null);
  }
  // Delivered datasets (sample / full).
  if ('sampleItems' in s) feed.sampleItems = s.sampleItems;
  if ('sampleFinished' in s) feed.sampleFinished = s.sampleFinished;
  if ('fullItems' in s) feed.fullItems = s.fullItems;
  if ('fullFinished' in s) feed.fullFinished = s.fullFinished;
  if ('deliveredPhase' in s) feed.deliveredPhase = s.deliveredPhase;
  if ('deliveredItems' in s) feed.deliveredItems = s.deliveredItems;
  if ('deliveredJobKey' in s) feed.deliveredJobKey = s.deliveredJobKey;
  if ('deliveredFinished' in s) feed.deliveredFinished = s.deliveredFinished;
}

// Attach crawl telemetry to each feed. scConfig = { prodProject, devProject }.
// Mutates feeds in place; returns a short status for diagnostics.
export async function enrichFeeds(epicKey, feeds, scConfig = {}) {
  if (!scrapyConfigured) return { status: 'not-configured', enriched: 0 };

  // Prefer the explicit prod/dev project fields on the Epic; otherwise fall
  // back to listing the data org and picking its prod/dev projects by name.
  // (Projects are needed only for the iteration/health jobq lookup — the
  // delivered sample/full jobs are fetched by their exact keys regardless.)
  let projects = [
    { id: scConfig.prodProject, env: 'prod' },
    { id: scConfig.devProject, env: 'dev' },
  ].filter((p) => p.id);
  let via = 'epic-projects';
  if (!projects.length && scConfig.org) {
    projects = rankProjects(await orgProjects(scConfig.org));
    via = 'org-listing';
  }

  // Resolve each feed's spider (explicit field, else derived from the domain).
  for (const f of feeds) {
    const spider = f.spiderName || deriveSpiderName(f.name);
    if (spider) f.spiderResolved = spider;
  }
  // Process any feed we can say something about: a resolvable spider (for
  // iteration/health) OR a Jira-linked delivered job (sample/full items).
  const toProcess = feeds
    .filter((f) => (f.spiderResolved && projects.length) || f.sampleJobKey || f.fullJobKey)
    .slice(0, MAX_FEEDS);
  if (!toProcess.length) {
    const status = projects.length ? 'no-spiders' : (scConfig.org ? 'no-projects-in-org' : 'no-projects');
    return { status, enriched: 0 };
  }

  const cacheKey = (f) => `${epicKey}:${f.key}`;
  const cache = {};
  if (svc) {
    try {
      const { data } = await svc.from('scrapy_jobs')
        .select('key, data, fetched_at').in('key', toProcess.map(cacheKey));
      for (const row of data || []) {
        if (row.data && Date.now() - new Date(row.fetched_at).getTime() < CACHE_TTL_MS) cache[row.key] = row.data;
      }
    } catch { /* table absent or pre-migration schema → fetch fresh */ }
  }

  let enriched = 0;
  const toCache = [];
  const probe = { calls: 0, ok: 0, status: {} }; // HTTP outcomes for diagnostics
  await Promise.all(toProcess.map(async (f) => {
    const k = cacheKey(f);
    if (cache[k]) { apply(f, cache[k]); enriched++; return; }
    const data = {};
    try {
      // Iteration + health from jobq (needs a resolvable spider + a project).
      if (f.spiderResolved && projects.length) {
        let summary = null;
        for (const p of projects) {        // production first, then development
          const jobs = await fetchSpiderJobs(p.id, f.spiderResolved, probe);
          if (jobs && jobs.length) { summary = summarize(jobs, p.id, p.env); break; }
        }
        if (summary) {
          let stats = null;
          try { stats = await fetchJobStats(summary.jobKey, probe); } catch { /* best-effort */ }
          Object.assign(summary, computeAlerts(summary, stats));
          Object.assign(data, summary);
        }
      }
      // Delivered datasets (sample cf_14251 / full cf_14250 job items).
      if (f.sampleJobKey || f.fullJobKey) Object.assign(data, await fetchDelivered(f, probe));

      if (Object.keys(data).length) {
        apply(f, data);
        enriched++;
        toCache.push({ key: k, epic_key: epicKey, spider: f.spiderResolved || null, data, fetched_at: new Date().toISOString() });
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
    via, spiders: toProcess.length, enriched,
    jobCalls: probe.calls, jobCallsOk: probe.ok, httpErrors: httpErrors || null, authRejected,
  };
  console.log('[scrapy]', epicKey, 'via', via, 'projects', debug.projects.join(','),
    'feeds', toProcess.length, 'enriched', enriched, 'jobCalls', probe.calls, 'ok', probe.ok,
    'httpErrors', httpErrors || 'none');
  return { status: enriched ? 'ok' : 'no-jobs', enriched, debug };
}
