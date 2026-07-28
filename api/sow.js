/* =========================================================================
   sow.js — read per-feed Subscription Price from the engagement's SOW.

   Pipeline (all server-side, all best-effort with graceful fallback):
     1. The Epic's "SOWs" field (customfield_13319) is a PUBLIC Salesforce
        content-distribution link — fetchable anonymously (verified).
     2. Resolve the file to its ORIGINAL_Pdf and download the bytes.
     3. Send the PDF to Claude (Anthropic API) → structured per-feed pricing.
     4. Cache the result in Supabase (sow_pricing) so we don't re-parse or
        re-bill Claude on every report load.

   Used by api/epic.js only to FILL GAPS: a feed's price comes from Jira
   (customfield_13599) when present; the SOW fills feeds where it's empty.

   ⚠️ The Salesforce fetch (steps 1–2) is the fragile link — Salesforce exposes
   the file ids only through a guest viewer call. resolveSowPdf() is written to
   FAIL SOFT: any problem returns null and the report shows "—" as before.
   Everything else (Claude extraction, caching, matching) is solid.
   ========================================================================= */
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // re-parse a SOW at most once/day

const svc = (SUPABASE_URL && SUPABASE_SERVICE)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { persistSession: false } })
  : null;

// Normalize a website/feed name to a match key: drop protocol, www, any
// "(Product)"/"(Review)" suffix, lowercase.
export function domainKey(s) {
  return String(s || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/\/.*$/, '')
    .trim()
    .toLowerCase();
}

// Parse a Salesforce content-distribution public link into its parts.
function parseDistribution(url) {
  if (!url) return null;
  const m = String(url).match(/^(https?:\/\/[^/]+)\/sfc\/p\/#?([^/]+)\/a\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  return { base: m[1], org: m[2], doc: m[3], token: m[4] };
}

// Best-effort: turn the public link into the raw PDF bytes (base64, no
// newlines). Returns null on any failure — caller degrades gracefully.
async function resolveSowPdf(url) {
  const d = parseDistribution(url);
  if (!d) { console.warn('[sow] could not parse distribution from', url); return null; }
  const distPath = `/a/${d.doc}/${d.token}`;
  const oid = d.org.startsWith('00D') ? d.org : `00D${d.org}`;
  try {
    // The download URL needs versionId (068…) + contentId (05T…). Salesforce
    // surfaces them via the guest viewer; try to recover them from the
    // distribution page's payload. If they aren't present, bail (fallback).
    const viewer = await fetch(`${d.base}/sfc/p/${d.org}/a/${d.doc}/${d.token}`);
    const html = await viewer.text();
    const versionId = (html.match(/068[A-Za-z0-9]{12,15}/) || [])[0];
    const contentId = (html.match(/05T[A-Za-z0-9]{12,15}/) || [])[0];
    console.log('[sow] viewer', viewer.status, 'bytes', html.length, 'versionId', versionId || 'MISSING', 'contentId', contentId || 'MISSING');
    if (!versionId || !contentId) return null; // fragile step failed → fallback

    const dl = `${d.base}/sfc/dist/version/renditionDownload?rendition=ORIGINAL_Pdf`
      + `&versionId=${versionId}&contentId=${contentId}&operationContext=DELIVERY`
      + `&page=0&oid=${oid}&d=${encodeURIComponent(distPath)}`;
    const resp = await fetch(dl);
    const ct = resp.headers.get('content-type') || '';
    console.log('[sow] download', resp.status, ct);
    if (!resp.ok || !ct.includes('pdf')) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf.toString('base64');
  } catch (e) {
    console.warn('[sow] resolveSowPdf error', String(e && e.message || e));
    return null;
  }
}

const PRICING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    currency: { type: ['string', 'null'] },
    feeds: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          site: { type: 'string' },
          subscriptionFee: { type: ['number', 'null'] },
          setupFee: { type: ['number', 'null'] },
          recordLimit: { type: ['number', 'null'] },
        },
        required: ['site', 'subscriptionFee', 'setupFee', 'recordLimit'],
      },
    },
  },
  required: ['currency', 'feeds'],
};

const EXTRACT_PROMPT =
  'This PDF is a Zyte Data Order Form / SOW. Find the per-feed pricing table '
  + '(columns like Feed / website, Set-Up Fee, Subscription Fee $/month, Record Limit). '
  + 'Return one row per website. Give fees as plain numbers — strip currency symbols and '
  + 'thousands separators (e.g. "$1,219" → 1219). Put the currency symbol or code in "currency". '
  + 'Use null for any missing value. Do NOT include subtotal/total/VAT rows.';

// Ask Claude to read the SOW PDF and return structured pricing.
async function extractPricing(pdfBase64) {
  if (!ANTHROPIC_KEY) return null;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: EXTRACT_PROMPT },
        ],
      }],
      output_config: { format: { type: 'json_schema', schema: PRICING_SCHEMA } },
    }),
  });
  if (!resp.ok) { console.warn('[sow] anthropic', resp.status, (await resp.text()).slice(0, 200)); return null; }
  const data = await resp.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    const parsed = JSON.parse(text);
    console.log('[sow] extracted', (parsed.feeds || []).length, 'feed rows, currency', parsed.currency);
    return parsed;
  } catch { console.warn('[sow] could not parse Claude output'); return null; }
}

// Public entry point. Returns { ok, status, currency, byDomain } — byDomain
// maps a normalized website → { subscriptionFee, setupFee, recordLimit }.
// `status` is a human-readable reason so the report can surface why it's empty.
export async function getSowPricing(epicKey, sowUrl) {
  const empty = (status) => ({ ok: false, status, currency: null, byDomain: {} });
  if (!sowUrl) return empty('no-sow-link');
  if (!ANTHROPIC_KEY) return empty('anthropic-not-configured');

  // 1. Cache hit?
  if (svc) {
    try {
      const { data } = await svc.from('sow_pricing').select('*').eq('epic_key', epicKey).maybeSingle();
      if (data && data.ok && data.fetched_at && (Date.now() - new Date(data.fetched_at).getTime() < CACHE_TTL_MS)) {
        return { ok: true, status: 'cached', currency: data.currency, byDomain: data.by_domain || {} };
      }
    } catch { /* cache miss / table absent → parse fresh */ }
  }

  // 2. Fetch + extract.
  const pdf = await resolveSowPdf(sowUrl);
  if (!pdf) return empty('sow-fetch-failed');
  const parsed = await extractPricing(pdf);
  if (!parsed || !Array.isArray(parsed.feeds)) return empty('extract-failed');

  const byDomain = {};
  for (const f of parsed.feeds) {
    const k = domainKey(f.site);
    if (k) byDomain[k] = { subscriptionFee: f.subscriptionFee, setupFee: f.setupFee, recordLimit: f.recordLimit };
  }
  const result = { ok: true, status: 'parsed', currency: parsed.currency || null, byDomain };

  // 3. Cache.
  if (svc) {
    try {
      await svc.from('sow_pricing').upsert({
        epic_key: epicKey, ok: true, currency: result.currency,
        by_domain: byDomain, fetched_at: new Date().toISOString(),
      }, { onConflict: 'epic_key' });
    } catch { /* best-effort */ }
  }
  return result;
}
