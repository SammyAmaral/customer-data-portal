/* Small presentational helpers shared by the views (pure, no state). */

// Money-ish number → thousands-separated string. No currency symbol (the Jira
// fields store a bare number); pass one in if you want a prefix.
export function fmtMoney(n, symbol = '') {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '—';
  return symbol + Number(n).toLocaleString('en-US');
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// RAG → colour tokens (CSS variables defined in App.jsx).
export const RAG = {
  green: { label: 'On track', color: 'var(--rag-green)' },
  amber: { label: 'At risk', color: 'var(--rag-amber)' },
  red: { label: 'Off track', color: 'var(--rag-red)' },
  blue: { label: 'Info', color: 'var(--blue)' },
  grey: { label: 'Not set', color: 'var(--slate)' },
};
export function ragToken(rag) {
  return RAG[rag] || { label: 'Not set', color: 'var(--slate)' };
}

// Jira status category (new | indeterminate | done) → chip colours. The label
// itself is the literal Jira status name, passed alongside.
export const STATUS_CAT = {
  new: { color: 'var(--slate)', tint: 'rgba(92,107,132,.12)' },
  indeterminate: { color: 'var(--rag-amber)', tint: 'rgba(214,138,52,.14)' },
  done: { color: 'var(--rag-green)', tint: 'rgba(14,156,120,.12)' },
};
export function statusToken(category) {
  return STATUS_CAT[category] || STATUS_CAT.new;
}

// Feed status bucket → colour + readable label for chips.
export const FEED = {
  done: { label: 'Delivered', color: 'var(--rag-green)', tint: 'rgba(14,156,120,.12)' },
  review: { label: 'In review', color: 'var(--blue)', tint: 'rgba(47,111,237,.12)' },
  qa: { label: 'QA passed', color: 'var(--grad-violet)', tint: 'rgba(107,27,150,.12)' },
  progress: { label: 'In progress', color: 'var(--amber)', tint: 'rgba(214,138,52,.14)' },
  blocked: { label: 'Blocked', color: 'var(--rag-red)', tint: 'rgba(196,67,47,.12)' },
  rejected: { label: 'Cancelled', color: 'var(--slate)', tint: 'rgba(92,107,132,.12)' },
  todo: { label: 'Not started', color: 'var(--slate)', tint: 'rgba(92,107,132,.10)' },
};
export function feedToken(bucket) {
  return FEED[bucket] || FEED.todo;
}

// The item count a report should show for a feed: the delivered dataset — the
// SAMPLE sent to the customer before approval, the FULL crawl after it — when
// we know it, else the latest crawl attempt. Keeps every view consistent.
export function feedItems(f) {
  if (!f) return null;
  if (f.deliveredItems != null) return f.deliveredItems;
  return f.records != null ? f.records : null;
}
// 'sample' | 'full' | null → short label for the phase behind feedItems().
export function deliveryPhaseLabel(phase) {
  if (phase === 'full') return 'full crawl';
  if (phase === 'sample') return 'sample';
  return null;
}

export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

// An engagement whose Epic status is still "To Do" hasn't started yet — show
// "Not started" instead of the derived phase ("Project Kickoff").
export function isNotStarted(status) {
  return /^(to ?do|backlog|open)$/i.test(String(status || '').trim());
}

// A percentage 0–100 of feeds delivered, for the progress bars.
export function donePct(counts) {
  if (!counts || !counts.total) return 0;
  return Math.round((counts.done / counts.total) * 100);
}
