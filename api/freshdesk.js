/* =========================================================================
   freshdesk.js — read open support tickets from Freshdesk and match them to a
   crawler / domain / engagement via a custom field on the ticket.

   Config (server-side env only — never in the client bundle):
     FRESHDESK_DOMAIN       your subdomain, e.g. "zyte" (…zyte.freshdesk.com)
     FRESHDESK_API_KEY      a Freshdesk API key (Basic auth, key as username)
     FRESHDESK_MATCH_FIELD  the custom-field key that holds the domain / crawler
                            / Jira key, e.g. "cf_domain". If unset, we fall back
                            to matching the site domain in the ticket subject.

   Open = status 2 (Open) or 3 (Pending). Results are cached per warm instance
   (3 min) to respect Freshdesk rate limits. All calls are best-effort: any
   failure returns null and the portal simply shows no tickets.
   ========================================================================= */
const FD_DOMAIN = (process.env.FRESHDESK_DOMAIN || '').replace(/\.freshdesk\.com.*$/i, '').replace(/^https?:\/\//, '').trim();
const FD_KEY = process.env.FRESHDESK_API_KEY || '';
const FD_FIELD = (process.env.FRESHDESK_MATCH_FIELD || '').trim();

export const freshdeskConfigured = Boolean(FD_DOMAIN && FD_KEY);

const PRIORITY = { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' };
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
const ticketUrl = (id) => `https://${FD_DOMAIN}.freshdesk.com/a/tickets/${id}`;

let CACHE = { at: 0, data: null };
const TTL_MS = 3 * 60 * 1000;

// Fetch the account's open + pending tickets (bounded), normalised to
// { id, subject, priority, status, value } where value = the match field.
export async function loadOpenTickets() {
  if (!freshdeskConfigured) return null;
  if (CACHE.data && Date.now() - CACHE.at < TTL_MS) return CACHE.data;

  const base = `https://${FD_DOMAIN}.freshdesk.com/api/v2`;
  const auth = 'Basic ' + Buffer.from(`${FD_KEY}:X`).toString('base64');
  const out = [];
  const seenFields = new Set();
  try {
    // Freshdesk search: up to 30 results/page, 10 pages. Plenty for open tickets.
    for (let page = 1; page <= 10; page++) {
      const query = encodeURIComponent('"(status:2 OR status:3)"');
      const resp = await fetch(`${base}/search/tickets?query=${query}&page=${page}`, {
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
      });
      if (!resp.ok) { console.warn('[freshdesk]', resp.status, page); break; }
      const body = await resp.json();
      const results = (body && body.results) || [];
      for (const t of results) {
        const cf = t.custom_fields || {};
        Object.keys(cf).forEach((k) => seenFields.add(k));
        out.push({ id: t.id, subject: t.subject || '', priority: t.priority || 1, status: t.status, value: FD_FIELD ? norm(cf[FD_FIELD]) : '' });
      }
      if (results.length < 30) break; // last page
    }
    if (FD_FIELD && out.length && !out.some((t) => t.value)) {
      console.warn(`[freshdesk] match field "${FD_FIELD}" is empty on all tickets — available custom fields:`, [...seenFields].join(', ') || '(none)');
    }
    console.log('[freshdesk]', out.length, 'open/pending tickets', FD_FIELD ? `· field ${FD_FIELD}` : '· subject match');
  } catch (e) {
    console.warn('[freshdesk] error', String((e && e.message) || e));
    return CACHE.data; // serve stale on error if we have it
  }
  CACHE = { at: Date.now(), data: out };
  return out;
}

// Tickets that match any of `candidates` (crawler key / domain / epic key) via
// the custom field, or — with no field configured — the domain in the subject.
function match(tickets, candidates, domainName) {
  const cands = (candidates || []).map(norm).filter(Boolean);
  const dn = norm(domainName);
  return (tickets || []).filter((t) => {
    if (FD_FIELD) return t.value && cands.includes(t.value);
    return dn && t.subject && norm(t.subject).includes(dn);
  });
}

// The open-ticket summary for one crawler/domain (top = highest priority).
export function freshdeskFor(tickets, candidates, domainName) {
  if (!tickets) return { open: false, configured: freshdeskConfigured };
  const m = match(tickets, candidates, domainName);
  if (!m.length) return { open: false, configured: true };
  const top = m.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
  return { open: true, count: m.length, id: top.id, priority: PRIORITY[top.priority] || 'Medium', subject: top.subject, url: ticketUrl(top.id), configured: true };
}

// Distinct open tickets across a whole engagement (epic + all its domains).
export function freshdeskCount(tickets, candidates, domainNames) {
  if (!tickets) return 0;
  const cands = (candidates || []).map(norm).filter(Boolean);
  const dns = (domainNames || []).map(norm).filter(Boolean);
  const ids = new Set();
  for (const t of tickets) {
    const hit = FD_FIELD ? (t.value && cands.includes(t.value)) : (t.subject && dns.some((d) => norm(t.subject).includes(d)));
    if (hit) ids.add(t.id);
  }
  return ids.size;
}
