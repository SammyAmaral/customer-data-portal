/* =========================================================================
   _access.js — shared server-side layer for the Customer Data Portal.

   Two responsibilities, both server-only (never bundled into the browser):
     1. Talk to Jira Cloud with a server-side Atlassian token.
     2. Turn the caller's Supabase session into an ACCESS SCOPE — which DOD
        engagements (Epics) that email is allowed to see.

   Authorization is the whole point of this app: a customer signs in with their
   own email and may see only the engagement(s) explicitly granted to them in
   the `report_access` allow-list. Internal Zyte staff (email domain in
   INTERNAL_DOMAINS) see everything. This check runs on EVERY /api data call —
   the client UI mirrors it, but this is the real gate.
   ========================================================================= */
import { createClient } from '@supabase/supabase-js';

/* ---- Jira config -------------------------------------------------------- */
export const JIRA_BASE = (process.env.JIRA_BASE_URL || '').replace(/\/+$/, '');
const EMAIL = process.env.JIRA_EMAIL || '';
const TOKEN = process.env.JIRA_API_TOKEN || '';
export const PROJECT = process.env.JIRA_PROJECT || 'DOD';
export const jiraConfigured = Boolean(JIRA_BASE && EMAIL && TOKEN);

/* ---- Supabase / auth config --------------------------------------------- */
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const INTERNAL_DOMAINS = (process.env.INTERNAL_DOMAINS || 'zyte.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
// When true (the default for now), ONLY internal-domain users get in — the
// per-customer allow-list is bypassed. Set INTERNAL_ONLY=false to re-enable
// external customer access via the report_access table.
const INTERNAL_ONLY = String(process.env.INTERNAL_ONLY || 'true').toLowerCase() !== 'false';
export const authConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON && SUPABASE_SERVICE);

/* ---- Jira fetch helpers ------------------------------------------------- */
function authHeader() {
  return 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
}

async function jiraFetch(path, init = {}) {
  const resp = await fetch(`${JIRA_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Jira ${resp.status}: ${detail.slice(0, 400)}`);
  }
  return resp.json();
}

// Page through the enhanced JQL search endpoint (token-based paging).
export async function fetchIssues({ jql, fields, expand }) {
  const out = [];
  let nextPageToken = null;
  let guard = 0;
  do {
    const body = { jql, fields, maxResults: 100 };
    if (expand) body.expand = expand;
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const data = await jiraFetch('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    out.push(...(data.issues || []));
    nextPageToken = data.isLast ? null : data.nextPageToken;
  } while (nextPageToken && ++guard < 50);
  return out;
}

// One issue, optionally with its changelog (used to derive feed sample dates).
export async function fetchIssue(key, { fields, expand } = {}) {
  const qs = new URLSearchParams();
  if (fields) qs.set('fields', fields.join(','));
  if (expand) qs.set('expand', expand);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}${suffix}`);
}

// Add a plain-text comment to an issue (ADF paragraph). Returns the created
// comment. The only Jira WRITE the portal performs.
export async function jiraComment(key, text) {
  const body = {
    body: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: String(text || '') }] }],
    },
  };
  return jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/* ---- Access scope from the caller's Supabase session -------------------- */
// Returns one of:
//   { ok:true, email, internal:true,  epicKeys:null }   → sees everything
//   { ok:true, email, internal:false, epicKeys:Set }    → only these Epic keys
//   { ok:false, status, error }                         → 401/500/501
export async function getUserScope(req) {
  if (!authConfigured) {
    return { ok: false, status: 501, error: 'Auth is not configured on the server (set SUPABASE_* env vars).' };
  }
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, error: 'Not signed in.' };

  // Verify the JWT with the anon client — this calls Supabase's auth server.
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.getUser(token);
  const email = data && data.user && data.user.email ? data.user.email.toLowerCase() : null;
  if (error || !email) return { ok: false, status: 401, error: 'Invalid or expired session.' };

  const domain = email.split('@')[1] || '';
  if (INTERNAL_DOMAINS.includes(domain)) {
    return { ok: true, email, internal: true, epicKeys: null };
  }

  // Internal-only mode: no external access at all (per-customer allow-list off).
  if (INTERNAL_ONLY) {
    return { ok: false, status: 403, error: 'This portal is restricted to Zyte staff. Please sign in with your @zyte.com Google account.' };
  }

  // External customer: resolve the explicit allow-list with the service role
  // (bypasses RLS — customers can never read this table directly).
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { persistSession: false } });
  const { data: rows, error: e2 } = await svc
    .from('report_access').select('epic_key').ilike('email', email);
  if (e2) return { ok: false, status: 500, error: 'Access lookup failed.' };
  const epicKeys = new Set((rows || []).map((r) => String(r.epic_key).toUpperCase().trim()));
  return { ok: true, email, internal: false, epicKeys };
}

// Small helper so every endpoint reports missing Jira config the same way.
export function requireJira(res) {
  if (jiraConfigured) return true;
  res.status(500).json({
    error: 'Server is missing Jira configuration.',
    hint: 'Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN in the environment.',
  });
  return false;
}
