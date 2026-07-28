/* =========================================================================
   scrapy.js — live crawl telemetry from Scrapy Cloud (HubStorage API).

   For each feed we know the Scrapy Cloud project (parsed from its job link)
   and spider name (customfield_14219). We ask HubStorage's jobq for that
   spider's latest job and read: item count (real records delivered), state,
   close-reason, error count, and finish time. This powers per-feed telemetry,
   a portfolio records-delivered rollup, and a job-health flag.

   Classic Scrapy Cloud API: HTTP Basic auth, API key as the username with an
   empty password. Base defaults to storage.scrapinghub.com (override with
   SCRAPYCLOUD_BASE). All best-effort with graceful fallback + [scrapy] logs.
   ========================================================================= */
import { createClient } from '@supabase/supabase-js';

const SC_KEY = process.env.SCRAPYCLOUD_API_KEY || '';
const SC_BASE = (process.env.SCRAPYCLOUD_BASE || 'https://storage.scrapinghub.com').replace(/\/+$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CACHE_TTL_MS = 60 * 60 * 1000; // crawl telemetry refreshes hourly
const MAX_FEEDS = 60;                // bound external calls per report

export const scrapyConfigured = Boolean(SC_KEY);

const svc = (SUPABASE_URL && SUPABASE_SERVICE)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { persistSession: false } })
  : null;

function authHeader() {
  return 'Basic ' + Buffer.from(`${SC_KEY}:`).toString('base64');
}

// jobq: latest job for a spider in a project. Returns a compact summary or null.
async function fetchLatestJob(project, spider) {
  const url = `${SC_BASE}/jobq/${project}/list?spider=${encodeURIComponent(spider)}&count=1`;
  const resp = await fetch(url, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
  if (!resp.ok) { console.warn('[scrapy] jobq', resp.status, project, spider); return null; }
  const text = await resp.text();
  const line = text.split('\n').map((l) => l.trim()).filter(Boolean)[0];
  if (!line) return null; // no jobs for this spider
  let j;
  try { j = JSON.parse(line); } catch { return null; }
  const finishedMs = j.finished_time || j.ts || null;
  return {
    records: Number.isFinite(j.items) ? j.items : (Number(j.items) || 0),
    state: j.state || null,                 // finished | running | pending | deleted
    closeReason: j.close_reason || null,     // finished | cancelled | failed | ...
    errors: Number(j.errors) || 0,
    finished: finishedMs ? new Date(finishedMs).toISOString().slice(0, 10) : null,
    jobKey: j.key || null,
  };
}

// Attach crawl telemetry to each feed that has a Scrapy Cloud project + spider.
// Mutates feeds in place; returns a short status for diagnostics.
export async function enrichFeeds(epicKey, feeds) {
  if (!scrapyConfigured) return { status: 'not-configured', enriched: 0 };
  const targets = feeds.filter((f) => f.scProject && f.spiderName).slice(0, MAX_FEEDS);
  if (!targets.length) return { status: 'no-linked-feeds', enriched: 0 };

  // Cache read (one query for all keys).
  const cacheKey = (f) => `${f.scProject}:${f.spiderName}`;
  const cache = {};
  if (svc) {
    try {
      const { data } = await svc.from('scrapy_jobs').select('*').in('key', targets.map(cacheKey));
      for (const row of data || []) {
        if (Date.now() - new Date(row.fetched_at).getTime() < CACHE_TTL_MS) cache[row.key] = row;
      }
    } catch { /* table absent / miss → fetch fresh */ }
  }

  let enriched = 0;
  const toCache = [];
  await Promise.all(targets.map(async (f) => {
    const k = cacheKey(f);
    let job = cache[k];
    if (job) {
      apply(f, job);
      enriched++;
      return;
    }
    try {
      const fresh = await fetchLatestJob(f.scProject, f.spiderName);
      if (fresh) {
        apply(f, fresh);
        enriched++;
        toCache.push({
          key: k, epic_key: epicKey, records: fresh.records, state: fresh.state,
          close_reason: fresh.closeReason, errors: fresh.errors, finished_at: fresh.finished,
          fetched_at: new Date().toISOString(),
        });
      }
    } catch (e) { console.warn('[scrapy] feed', f.key, String(e && e.message || e)); }
  }));

  if (svc && toCache.length) {
    try { await svc.from('scrapy_jobs').upsert(toCache, { onConflict: 'key' }); } catch { /* best-effort */ }
  }
  console.log('[scrapy]', epicKey, 'linked', targets.length, 'enriched', enriched);
  return { status: enriched ? 'ok' : 'no-jobs', enriched };
}

function apply(feed, job) {
  // Cache rows use snake_case; live jobs use camelCase — normalize both.
  feed.records = Number(job.records) || 0;
  feed.jobState = job.state || null;
  feed.jobErrors = Number(job.errors) || 0;
  feed.jobCloseReason = job.closeReason ?? job.close_reason ?? null;
  feed.jobFinished = job.finished ?? job.finished_at ?? null;
  // Health: problem if the latest job didn't finish cleanly or logged errors.
  const cr = feed.jobCloseReason;
  feed.jobHealthy = feed.jobState === 'finished' && (!cr || cr === 'finished') && !feed.jobErrors;
}
