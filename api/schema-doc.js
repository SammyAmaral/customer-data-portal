/* =========================================================================
   /api/schema-doc?feed=DOD-#### — a customer-safe, rendered view of a feed's
   data schema, so customers never get redirected to the private Bitbucket repo.

   Access is authorized via the feed's PARENT epic (same as /api/comments):
   internal sees all; external only if the parent epic is in their scope.

   Two sources, tried in order (graceful degradation):
     1. "schema"   — if BITBUCKET_TOKEN is configured and the feed's Feed Schema
        field (cf_13726) points at a Bitbucket JSON-Schema file, fetch + parse it
        server-side into { name, type, required, description } rows.
     2. "coverage" — otherwise, read the latest crawl job's item field coverage
        from HubStorage (the same key-authed host used by /api/coverage) and
        return the field names + fill %. No new credential needed.

   The raw Bitbucket URL is only ever returned to INTERNAL callers.
   ========================================================================= */
import { getUserScope, requireJira, fetchIssue } from './_access.js';
import { CF, firstLink, stripPrefix, adfText, dateOnly } from './_map.js';

const BB_TOKEN = process.env.BITBUCKET_TOKEN || '';
const BB_USER = process.env.BITBUCKET_USER || '';
const SC_KEY = process.env.SCRAPYCLOUD_API_KEY || '';
const SC_BASE = (process.env.SCRAPYCLOUD_BASE || 'https://storage.scrapinghub.com').replace(/\/+$/, '');

function scAuthHeader() { return 'Basic ' + Buffer.from(`${SC_KEY}:`).toString('base64'); }
function bbAuthHeader() {
  // Workspace/repo access token → Bearer; account app-password → Basic user:token.
  return BB_USER ? 'Basic ' + Buffer.from(`${BB_USER}:${BB_TOKEN}`).toString('base64') : `Bearer ${BB_TOKEN}`;
}

// bitbucket.org/{ws}/{repo}/src/{ref}/{path}  →  api.bitbucket.org src endpoint.
function bitbucketApiUrl(webUrl) {
  const m = String(webUrl || '').match(/bitbucket\.org\/([^/]+)\/([^/]+)\/(?:src|raw)\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, ws, repo, ref, path] = m;
  return `https://api.bitbucket.org/2.0/repositories/${ws}/${repo}/src/${ref}/${path}`;
}

function typeName(def) {
  if (!def || typeof def !== 'object') return 'any';
  if (def.type) return Array.isArray(def.type) ? def.type.join(' | ') : String(def.type);
  if (def.enum) return 'enum';
  if (def.$ref) return 'object';
  if (def.anyOf || def.oneOf) return 'mixed';
  return 'any';
}

// A JSON-Schema (or a plain {field: {...}} item definition) → field rows.
function fieldsFromJsonSchema(schema) {
  const root = (schema && schema.properties) ? schema
    : (schema && schema.items && schema.items.properties) ? schema.items
    : schema;
  const props = (root && root.properties) || {};
  const required = new Set((root && root.required) || []);
  return Object.entries(props).map(([name, def]) => ({
    name,
    type: typeName(def),
    required: required.has(name),
    description: (def && (def.description || def.title)) || '',
  }));
}

export default async function handler(req, res) {
  const scope = await getUserScope(req);
  if (!scope.ok) { res.status(scope.status).json({ error: scope.error }); return; }
  if (!requireJira(res)) return;

  const feed = String((req.query && req.query.feed) || '').toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(feed)) {
    res.status(400).json({ error: 'A valid feed key is required, e.g. ?feed=DOD-14218.' });
    return;
  }

  try {
    const issue = await fetchIssue(feed, {
      fields: ['parent', 'summary', CF.feedSchema, CF.jobLinkFull, CF.jobLinkSample, CF.sampleApprovedDate],
    });
    if (!issue || !issue.fields) { res.status(404).json({ error: 'Feed not found.' }); return; }

    const f = issue.fields;
    const parentKey = f.parent && f.parent.key;
    if (!scope.internal && !(parentKey && scope.epicKeys && scope.epicKeys.has(parentKey))) {
      res.status(403).json({ error: 'You do not have access to this feed.' });
      return;
    }

    const name = stripPrefix(f.summary) || feed;
    const schemaUrl = firstLink(f[CF.feedSchema]);
    const base = { ok: true, feed, name };
    if (scope.internal && schemaUrl) base.schemaUrl = schemaUrl; // never leak the Bitbucket link to customers

    // ---- 1. Real schema from Bitbucket (if configured) --------------------
    const apiUrl = schemaUrl && BB_TOKEN ? bitbucketApiUrl(schemaUrl) : null;
    if (apiUrl) {
      try {
        const resp = await fetch(apiUrl, { headers: { Authorization: bbAuthHeader(), Accept: 'application/json' } });
        if (resp.ok) {
          const schema = await resp.json();
          const fields = fieldsFromJsonSchema(schema);
          if (fields.length) {
            res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
            res.status(200).json({ ...base, source: 'schema', fields });
            return;
          }
        } else {
          console.warn('[schema-doc] bitbucket', resp.status, feed);
        }
      } catch (e) {
        console.warn('[schema-doc] bitbucket error', feed, String((e && e.message) || e));
      }
    }

    // ---- 2. Fallback: live field coverage from the DELIVERED crawl job -----
    // The dataset the customer received: the full crawl once the sample is
    // approved, otherwise the sample.
    const approved = !!dateOnly(f[CF.sampleApprovedDate]);
    const fullLink = adfText(f[CF.jobLinkFull]) || '';
    const sampleLink = adfText(f[CF.jobLinkSample]) || '';
    const deliveredLink = approved ? (fullLink || sampleLink) : (sampleLink || fullLink);
    const jm = deliveredLink.match(/\/p\/(\d+)\/(\d+)\/(\d+)/);
    const job = jm ? `${jm[1]}/${jm[2]}/${jm[3]}` : null;
    if (job && SC_KEY) {
      try {
        const resp = await fetch(`${SC_BASE}/items/${job}/stats?format=json`, {
          headers: { Authorization: scAuthHeader(), Accept: 'application/json' },
        });
        if (resp.ok) {
          const body = await resp.json();
          const counts = (body && (body.counts || body.fields)) || {};
          const values = Object.values(counts).map(Number).filter(Number.isFinite);
          const total = (body && body.totals && (body.totals.input_values ?? body.totals.count))
            || (values.length ? Math.max(...values) : 0);
          const fields = Object.entries(counts)
            .map(([fname, count]) => ({ name: fname, count: Number(count) || 0, pct: total ? Math.round((Number(count) / total) * 100) : 0 }))
            .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
          if (fields.length) {
            res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
            res.status(200).json({ ...base, source: 'coverage', total, fields });
            return;
          }
        }
      } catch (e) {
        console.warn('[schema-doc] coverage error', feed, String((e && e.message) || e));
      }
    }

    // ---- Nothing available yet -------------------------------------------
    res.status(200).json({ ...base, source: 'none', fields: [] });
  } catch (err) {
    res.status(502).json({ error: 'Failed to build the schema view.', detail: String((err && err.message) || err) });
  }
}
