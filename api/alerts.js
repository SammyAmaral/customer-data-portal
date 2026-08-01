/* =========================================================================
   /api/alerts — portfolio-wide crawler-alert rollup for the PM view.

   Aggregates the per-feed alerts already cached in `scrapy_jobs` (populated by
   the Technical view / epic detail) into a per-engagement summary — a cheap
   single DB read, NOT a fresh fan-out across every engagement's crawlers.
   Internal-only. So an engagement shows alert data once its crawlers have been
   checked (its Technical view opened, or a future scheduled warmer runs).
   ========================================================================= */
import { getUserScope } from './_access.js';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const svc = (SUPABASE_URL && SUPABASE_SERVICE)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { persistSession: false } })
  : null;

export default async function handler(req, res) {
  const scope = await getUserScope(req);
  if (!scope.ok) { res.status(scope.status).json({ error: scope.error }); return; }
  // Crawler alerts are internal-only; customers get an empty map (no error).
  if (!scope.internal || !svc) { res.status(200).json({ ok: true, byEpic: {} }); return; }

  try {
    const { data, error } = await svc.from('scrapy_jobs').select('epic_key, data, fetched_at');
    if (error) { res.status(200).json({ ok: false, byEpic: {} }); return; }
    const byEpic = {};
    for (const row of data || []) {
      const ek = row.epic_key;
      if (!ek) continue;
      const d = row.data || {};
      const alerts = Array.isArray(d.alerts) ? d.alerts : [];
      const b = byEpic[ek] || (byEpic[ek] = { feeds: 0, alertFeeds: 0, high: 0, warn: 0, checkedAt: null });
      b.feeds += 1;
      if (alerts.length) b.alertFeeds += 1;
      for (const a of alerts) { if (a && a.level === 'high') b.high += 1; else if (a) b.warn += 1; }
      if (row.fetched_at && (!b.checkedAt || row.fetched_at > b.checkedAt)) b.checkedAt = row.fetched_at;
    }
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.status(200).json({ ok: true, byEpic });
  } catch (e) {
    res.status(200).json({ ok: false, byEpic: {}, detail: String((e && e.message) || e) });
  }
}
