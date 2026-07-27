/* =========================================================================
   _map.js — pure Jira → report mapping. No network, no env, no browser APIs,
   so it is unit-testable with plain Node (see _map.test.mjs).

   Field ids + names confirmed against live DOD data (expand=names on DOD-14209):
     Start date            customfield_13305
     Planned Finish Date   customfield_13553   (falls back to standard duedate)
     RAG Status            customfield_13534   (array select — the health light)
     Effort RAG            customfield_15692   (single select — secondary)
     Account Owner (AM)    customfield_13550   (user)
     Customer Project  Contact  name/email  customfield_13689 / customfield_13690
     Customer Technical Contact name/email  customfield_13691 / customfield_13692
     Salesforce Account Name customfield_15128 (clean customer name)
     Scope & Assumptions   customfield_13590   (ADF)
     Out of Scope          customfield_13591   (ADF)
     Project Status:       customfield_13671   (ADF dated update log)
     Solution Architect    customfield_13312   (user, internal-only)
     Slack Internal        customfield_13713   (ADF, internal-only)
     SF/SoW/SAT links      customfield_13575 / 13319 / 13554 / 13555 (internal-only)
   ========================================================================= */

export const CF = {
  startDate: 'customfield_13305',
  plannedFinish: 'customfield_13553',
  ragStatus: 'customfield_13534',
  effortRag: 'customfield_15692',
  accountOwner: 'customfield_13550',
  projContactName: 'customfield_13689',
  projContactEmail: 'customfield_13690',
  techContactName: 'customfield_13691',
  techContactEmail: 'customfield_13692',
  customer: 'customfield_15128',
  scope: 'customfield_13590',
  outOfScope: 'customfield_13591',
  projectStatus: 'customfield_13671',
  solutionArchitect: 'customfield_13312',
  slack: 'customfield_13713',
  sfOpportunity: 'customfield_13575',
  sows: 'customfield_13319',
  satForm: 'customfield_13554',
  satLink: 'customfield_13555',
};

// Fields to request for the portfolio (Epic list) — keep it lean.
export const EPIC_LIST_FIELDS = [
  'summary', 'status', 'assignee', 'duedate', 'updated', 'issuetype',
  CF.startDate, CF.plannedFinish, CF.ragStatus, CF.effortRag, CF.customer, CF.accountOwner,
];

// Fields for a single engagement's full detail.
export const EPIC_DETAIL_FIELDS = [
  'summary', 'status', 'assignee', 'duedate', 'description', 'created', 'updated',
  CF.startDate, CF.plannedFinish, CF.ragStatus, CF.effortRag, CF.customer, CF.accountOwner,
  CF.projContactName, CF.projContactEmail, CF.techContactName, CF.techContactEmail,
  CF.scope, CF.outOfScope, CF.projectStatus, CF.solutionArchitect, CF.slack,
  CF.sfOpportunity, CF.sows, CF.satForm, CF.satLink,
];

export const CHILD_FIELDS = ['summary', 'status', 'issuetype', 'created', 'resolutiondate'];

/* ---- ADF / value helpers ------------------------------------------------ */
export function adfText(n) {
  if (n == null) return '';
  if (typeof n === 'string') return n;
  if (Array.isArray(n)) return n.map(adfText).join('');
  switch (n.type) {
    case 'text': return n.text || '';
    case 'mention': return (n.attrs && (n.attrs.text || n.attrs.displayName)) || '';
    case 'hardBreak': return '\n';
    case 'paragraph': return adfText(n.content) + '\n';
    case 'listItem': return '• ' + adfText(n.content) + '\n';
    case 'bulletList': return adfText(n.content);
    case 'orderedList': return adfText(n.content);
    case 'inlineCard': return (n.attrs && n.attrs.url) || '';
    default: return n.content ? adfText(n.content) : '';
  }
}

export function cleanText(s) {
  return String(s == null ? '' : s).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ADF → array of non-empty lines (for bullet-style narrative panels).
export function adfLines(field) {
  const text = adfText(field);
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

export function personName(field) {
  return field && field.displayName ? field.displayName : null;
}

// Pull the first URL out of a field that may be a plain string or ADF with a link mark.
export function firstLink(field) {
  if (!field) return null;
  if (typeof field === 'string') {
    const m = field.match(/https?:\/\/\S+/);
    return m ? m[0] : (field.startsWith('http') ? field : null);
  }
  const text = adfText(field);
  const m = text.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

// RAG select → 'green' | 'amber' | 'red' | 'blue' | 'grey' | null.
// Handles both single-select {value} and array [{value}] shapes.
export function ragValue(field) {
  let v = null;
  if (Array.isArray(field)) v = field.length ? field[0].value : null;
  else if (field && typeof field === 'object') v = field.value || null;
  else if (typeof field === 'string') v = field;
  if (!v) return null;
  const s = v.toLowerCase();
  if (s.includes('green')) return 'green';
  if (s.includes('amber') || s.includes('yellow') || s.includes('orange')) return 'amber';
  if (s.includes('red')) return 'red';
  if (s.includes('blue')) return 'blue';
  if (s.includes('grey') || s.includes('gray')) return 'grey';
  return s;
}

// Strip the "[Customer - Month] - " prefix teams put on child summaries.
export function stripPrefix(summary) {
  return cleanText(String(summary || '').replace(/^\s*\[[^\]]*\]\s*[-–]?\s*/, ''));
}

/* ---- Business days ------------------------------------------------------ */
// Business days strictly after `from`, up to and including `to`.
export function businessDaysBetween(from, to) {
  const a = new Date(from), b = new Date(to);
  if (isNaN(a) || isNaN(b) || b <= a) return 0;
  let count = 0;
  const d = new Date(a);
  d.setDate(d.getDate() + 1);
  while (d <= b) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/* ---- Feed status buckets & phases --------------------------------------- */
// A crawling-component's workflow status → a coarse bucket for the feed table.
export function feedBucket(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('block')) return 'blocked';
  if (s.includes('reject') || s.includes('cancel')) return 'rejected';
  if (/(done|delivered|closed|complete)/.test(s)) return 'done';
  if (/(customer feedback|sample|approv|uat)/.test(s)) return 'review';
  if (/(qa|quality)/.test(s)) return 'qa';
  if (/(in progress|development|in dev)/.test(s)) return 'progress';
  return 'todo';
}

export const PHASES = ['Project Kickoff', 'Development', 'Q&A', 'Sample & Approval', 'In Production'];

// Where a single feed sits on the phase timeline.
function feedPhaseIndex(status) {
  switch (feedBucket(status)) {
    case 'done': return 4;
    case 'review': return 3;
    case 'qa': return 2;
    case 'progress': return 1;
    case 'blocked': return 1; // blocked work is mid-flight
    default: return 0;
  }
}

// Overall engagement phase: the furthest a feed has reached, but only "In
// Production" once EVERY feed is done. Falls back to Kickoff when no feeds
// have started yet. `tasksDone` nudges an all-todo project into Development
// once the kickoff/solution-design tasks are complete.
export function derivePhase(feedStatuses, kickoffDone = false) {
  const feeds = (feedStatuses || []).filter(Boolean);
  if (feeds.length && feeds.every((s) => feedBucket(s) === 'done')) return 4;
  let idx = 0;
  for (const s of feeds) {
    const p = feedPhaseIndex(s);
    if (p < 4 && p > idx) idx = p; // ignore individual "done" feeds when others lag
  }
  if (idx === 0 && kickoffDone) idx = 1;
  return idx;
}

/* ---- Sample dates from a feed's changelog ------------------------------- */
// histories: array of { created, items:[{field,toString,...}] } (Jira changelog).
// 1st Sample Sent = first transition INTO a customer-feedback/sample status.
// Sample Approved = first transition INTO a done/approved status at/after that.
export function sampleDatesFromChangelog(histories) {
  let sent = null, approved = null;
  const rows = (histories || [])
    .filter((h) => h && h.created && Array.isArray(h.items))
    .map((h) => ({ when: h.created, items: h.items }))
    .sort((a, b) => new Date(a.when) - new Date(b.when));
  for (const r of rows) {
    for (const it of r.items) {
      if (it.field !== 'status') continue;
      const to = (it.toString || '').toLowerCase();
      if (!sent && /(customer feedback|sample)/.test(to)) sent = r.when.slice(0, 10);
      if (!approved && /(done|delivered|approv|complete|closed)/.test(to)) approved = r.when.slice(0, 10);
    }
  }
  return { firstSampleSent: sent, sampleApproved: approved };
}

/* ---- Row mappers -------------------------------------------------------- */
export function customerName(issue) {
  const f = issue.fields || {};
  const clean = cleanText(f[CF.customer]);
  if (clean) return clean;
  // Fall back to the summary before the " - <Month Year>" suffix.
  const sum = cleanText(f.summary);
  const m = sum.match(/^(.*?)[-–]\s*[A-Za-z]{3,9}[’']?\s*\d{2,4}/);
  return m ? cleanText(m[1]) : sum;
}

// One portfolio row. `feedCounts` and `phase` are computed by the caller from
// the Epic's children (a batched query), so this stays pure.
export function mapEpicListRow(issue, { feedCounts = null, phase = null } = {}) {
  const f = issue.fields || {};
  return {
    key: issue.key,
    customer: customerName(issue),
    summary: cleanText(f.summary),
    status: f.status ? f.status.name : 'Unknown',
    rag: ragValue(f[CF.ragStatus]) || ragValue(f[CF.effortRag]),
    pm: personName(f.assignee),
    am: personName(f[CF.accountOwner]),
    startDate: f[CF.startDate] || null,
    plannedFinish: f[CF.plannedFinish] || f.duedate || null,
    updated: f.updated ? f.updated.slice(0, 10) : null,
    phase,
    feedCounts,
  };
}

// Full detail for one engagement. `internal` gates Zyte-only fields; financial
// / margin fields are never mapped at all (customer-safe build).
export function mapEpicDetail(issue, { internal = false } = {}) {
  const f = issue.fields || {};
  const contacts = [];
  if (cleanText(f[CF.projContactName]) || cleanText(f[CF.projContactEmail])) {
    contacts.push({ role: 'Customer Project Contact', name: cleanText(f[CF.projContactName]) || null, email: cleanText(f[CF.projContactEmail]) || null });
  }
  if (cleanText(f[CF.techContactName]) || cleanText(f[CF.techContactEmail])) {
    contacts.push({ role: 'Customer Technical Contact', name: cleanText(f[CF.techContactName]) || null, email: cleanText(f[CF.techContactEmail]) || null });
  }

  const detail = {
    key: issue.key,
    name: cleanText(f.summary),
    customer: customerName(issue),
    status: f.status ? f.status.name : 'Unknown',
    rag: ragValue(f[CF.ragStatus]) || ragValue(f[CF.effortRag]),
    effortRag: ragValue(f[CF.effortRag]),
    startDate: f[CF.startDate] || null,
    plannedFinish: f[CF.plannedFinish] || f.duedate || null,
    pm: personName(f.assignee),
    am: personName(f[CF.accountOwner]),
    contacts,
    overview: cleanText(adfText(f.description)) || null,
    scope: adfLines(f[CF.scope]),
    outOfScope: adfLines(f[CF.outOfScope]),
    projectStatus: adfLines(f[CF.projectStatus]),
  };

  if (internal) {
    detail.internal = {
      solutionArchitect: personName(f[CF.solutionArchitect]),
      slack: cleanText(adfText(f[CF.slack])) || null,
      links: [
        { label: 'SoW', url: firstLink(f[CF.sows]) },
        { label: 'SF Opportunity', url: firstLink(f[CF.sfOpportunity]) },
        { label: 'SAT form', url: firstLink(f[CF.satForm]) },
        { label: 'SAT ticket', url: firstLink(f[CF.satLink]) },
      ].filter((l) => l.url),
    };
  }
  return detail;
}

// One feed row for the Data Feed Status table.
export function mapFeed(issue, histories, asOf) {
  const f = issue.fields || {};
  const status = f.status ? f.status.name : 'Unknown';
  const { firstSampleSent, sampleApproved } = sampleDatesFromChangelog(histories);
  const created = f.created || null;
  const end = sampleApproved || f.resolutiondate || asOf;
  return {
    key: issue.key,
    name: stripPrefix(f.summary) || issue.key,
    status,
    bucket: feedBucket(status),
    firstSampleSent,
    sampleApproved,
    daysOpen: created ? businessDaysBetween(created, end) : null,
  };
}
