/* =========================================================================
   /api/coverage?job=PROJECT/SPIDER/JOB — per-field coverage for one crawl job,
   mirroring Scrapy Cloud's "item field coverage".

   Reads HubStorage's item stats (storage.scrapinghub.com/items/{job}/stats) —
   the same key-authenticated host that already works server-side for jobq.
   coverage% for a field = value-count / total-items. Internal-only.
   `[coverage]` logs surface the raw stats keys so the parser can be confirmed
   live (the exact key names, like the jobs API, are verified from logs).
   ========================================================================= */
import { getUserScope } from './_access.js';

const SC_KEY = process.env.SCRAPYCLOUD_API_KEY || '';
const SC_BASE = (process.env.SCRAPYCLOUD_BASE || 'https://storage.scrapinghub.com').replace(/\/+$/, '');
function authHeader() { return 'Basic ' + Buffer.from(`${SC_KEY}:`).toString('base64'); }

export default async function handler(req, res) {
  const scope = await getUserScope(req);
  if (!scope.ok) { res.status(scope.status).json({ error: scope.error }); return; }
  if (!scope.internal) { res.status(403).json({ error: 'The technical view is internal-only.' }); return; }
  if (!SC_KEY) { res.status(200).json({ ok: false, status: 'not-configured' }); return; }

  const job = String((req.query && req.query.job) || '').trim();
  if (!/^\d+\/\d+\/\d+$/.test(job)) {
    res.status(400).json({ error: 'A valid job key is required, e.g. ?job=123/4/5.' });
    return;
  }

  try {
    const url = `${SC_BASE}/items/${job}/stats?format=json`;
    const resp = await fetch(url, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
    if (!resp.ok) {
      console.warn('[coverage] stats', resp.status, job);
      res.status(200).json({ ok: false, status: `http-${resp.status}`, job });
      return;
    }
    const body = await resp.json();
    // HubStorage item stats: per-field value counts + item totals. Field names
    // differ across shapes (counts | fields), so read defensively + log keys.
    const counts = (body && (body.counts || body.fields)) || {};
    const values = Object.values(counts).map(Number).filter(Number.isFinite);
    const total = (body && body.totals && (body.totals.input_values ?? body.totals.count))
      || (values.length ? Math.max(...values) : 0);
    const fields = Object.entries(counts)
      .map(([name, count]) => ({ name, count: Number(count) || 0, pct: total ? Math.round((Number(count) / total) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
    console.log('[coverage]', job, 'total', total, 'fields', fields.length, 'keys', Object.keys(body || {}).join(','));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ ok: true, job, total, fields });
  } catch (e) {
    console.warn('[coverage] error', job, String((e && e.message) || e));
    res.status(200).json({ ok: false, status: 'error', job });
  }
}
