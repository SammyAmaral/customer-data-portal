/* =========================================================================
   QAReport — a live QA / SLA report for an engagement (#/qa/{KEY}), built on
   Zyte's service-level metrics: actual vs target, per domain and aggregated.

   Three live filters: multi-select Domain dropdown, a domain search (filters
   the whole report), and a start/end date range (the reporting period).

   Data policy: the SLA targets are Zyte's proposed service levels; the ACTUALS
   are REPRESENTATIVE (clearly labelled), derived deterministically per
   (domain, period) so they're stable and respond to the filters — until the
   live QA/SLA pipeline emits real per-run results.
   ========================================================================= */
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Printer, ShieldCheck, CheckCircle2, AlertTriangle, XCircle, Search, Calendar } from 'lucide-react';
import { fetchWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { useChrome } from '../lib/chrome.jsx';
import { fmtDate, cx } from '../lib/ui.js';
import { SortHeader, useSort, sortRows } from '../components/SortHeader.jsx';
import AccessDenied from './AccessDenied.jsx';

/* ---- Zyte service-level metrics ----------------------------------------- */
const METRICS = [
  { key: 'coverage',     label: 'Coverage per run',          def: 'Items retrieved ÷ items expected, measured per site',       target: '≥ 98%',         good: 'gte', t: 98,   warn: 96,  fmt: (v) => `${v.toFixed(1)}%` },
  { key: 'accuracy',     label: 'Field-level accuracy',       def: 'Match against agreed reference set, core fields',           target: '≥ 99%',         good: 'gte', t: 99,   warn: 97,  fmt: (v) => `${v.toFixed(1)}%` },
  { key: 'ontime',       label: 'On-time delivery',           def: 'Runs landing inside the agreed window',                     target: '100%',          good: 'gte', t: 100,  warn: 98,  fmt: (v) => `${v.toFixed(1)}%` },
  { key: 'schema',       label: 'Schema validity',            def: 'Records passing type, format and required-field checks',    target: '≥ 99.9%',       good: 'gte', t: 99.9, warn: 99,  fmt: (v) => `${v.toFixed(2)}%` },
  { key: 'detect',       label: 'Time to detect',             def: 'Breakage flagged from a broken parser or blocked site',     target: '< 1 run cycle', good: 'lt',  t: 1,    warn: 1.5, agg: 'max', fmt: (v) => `${v.toFixed(1)} cycles` },
  { key: 'response',     label: 'Time to first response',     def: 'A human acknowledges and owns the incident',               target: '< 24 h',        good: 'lt',  t: 24,   warn: 36,  agg: 'max', fmt: (v) => `${Math.round(v)} h` },
  { key: 'restoreCrit',  label: 'Time to restore — critical', def: 'Data flowing correctly again on a revenue-critical domain', target: '< 2 days',      good: 'lt',  t: 2,    warn: 3,   agg: 'max', fmt: (v) => `${v.toFixed(1)} days` },
  { key: 'restoreOther', label: 'Time to restore — other',    def: 'Data flowing correctly again on remaining domains',         target: '< 5 days',      good: 'lt',  t: 5,    warn: 7,   agg: 'max', fmt: (v) => `${v.toFixed(1)} days` },
  { key: 'selfReported', label: 'Self-reported incidents',    def: 'Issues we raise vs. issues you find first',                 target: '100% ours',     good: 'gte', t: 99.5, warn: 90,  fmt: (v) => `${v.toFixed(0)}% ours` },
];

function statusFor(m, v) {
  if (v == null || Number.isNaN(v)) return 'na';
  if (m.good === 'gte') return v >= m.t ? 'pass' : v >= m.warn ? 'warn' : 'fail';
  return v < m.t ? 'pass' : v < m.warn ? 'warn' : 'fail';
}

/* ---- deterministic representative actuals (per domain, per period) ------- */
function hash(s) { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function domainMetrics(key, seed) {
  const h = hash(`${key}|${seed}`);
  const pick = (shift, lo, hi) => lo + ((h >>> shift) % (Math.round((hi - lo) * 10) + 1)) / 10;
  return {
    coverage: clamp(pick(0, 96.5, 100), 0, 100),
    accuracy: clamp(pick(3, 98.2, 100), 0, 100),
    ontime: clamp(pick(6, 96, 100), 0, 100),
    schema: clamp(pick(9, 99.8, 100), 0, 100),
    detect: pick(12, 0.1, 1.4),
    response: pick(15, 3, 30),
    restoreCrit: pick(18, 0.5, 2.8),
    restoreOther: pick(21, 1, 5.8),
    selfReported: clamp(pick(24, 96, 100), 0, 100),
    incidents: (h >>> 27) % 4,
  };
}
function domainStatus(dm) {
  const grades = METRICS.map((m) => statusFor(m, dm[m.key]));
  return grades.includes('fail') ? 'fail' : grades.includes('warn') ? 'warn' : 'pass';
}
// Aggregate a metric across the shown domains: max for durations, avg otherwise.
function aggregate(list, m) {
  if (!list.length) return null;
  const vals = list.map((d) => d[m.key]);
  return m.agg === 'max' ? Math.max(...vals) : vals.reduce((s, v) => s + v, 0) / vals.length;
}

const STATUS_RANK = { pass: 0, warn: 1, fail: 2, na: 3 };
const DOMAIN_COLS = {
  name: { get: (r) => r.f.name, kind: 'str' },
  coverage: { get: (r) => r.m.coverage, kind: 'num' },
  accuracy: { get: (r) => r.m.accuracy, kind: 'num' },
  schema: { get: (r) => r.m.schema, kind: 'num' },
  ontime: { get: (r) => r.m.ontime, kind: 'num' },
  incidents: { get: (r) => r.m.incidents, kind: 'num' },
  status: { get: (r) => STATUS_RANK[domainStatus(r.m)] ?? 9, kind: 'num' },
};

const GRADE_ICON = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle, na: AlertTriangle };
function GradeChip({ grade, children }) {
  const Icon = GRADE_ICON[grade] || AlertTriangle;
  return <span className={cx('cdp-qagrade', grade)}><Icon size={13} />{children || (grade === 'na' ? 'No data' : grade)}</span>;
}

const isoDay = (d) => d.toISOString().slice(0, 10);

export default function QAReport({ epicKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [domainSel, setDomainSel] = useState(() => new Set());
  const [start, setStart] = useState(() => isoDay(new Date(Date.now() - 30 * 864e5)));
  const [end, setEnd] = useState(() => isoDay(new Date()));
  const { sort, onSort } = useSort({ key: 'status', dir: 'desc' }); // worst-first
  const { setEngagement } = useChrome();

  useEffect(() => {
    let alive = true; setData(null); setError(null);
    fetchWithAuth(`/api/epic?key=${encodeURIComponent(epicKey)}`)
      .then((d) => alive && setData(d)).catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [epicKey]);
  useEffect(() => { if (data) setEngagement({ key: data.key, customer: data.customer, internal: !!data.internal }); }, [data, setEngagement]);

  if (error && error.status === 403) return <AccessDenied message={error.message} />;
  if (error) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <h3>Couldn’t load the QA report</h3><p>{error.message}</p>
      <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate(`#/report/${epicKey}`)}><ArrowLeft size={15} /> Status report</button>
    </div></div>;
  }
  if (!data) return <div className="cdp-center"><div className="cdp-spinner" /></div>;

  const feeds = data.feeds || [];
  const domainOptions = [...new Set(feeds.map((f) => f.name))].sort((a, b) => a.localeCompare(b));
  const needle = q.trim().toLowerCase();
  const period = start.slice(0, 7); // seeds representative actuals; shifts with the range

  const shown = feeds
    .filter((f) => domainSel.size === 0 || domainSel.has(f.name))
    .filter((f) => !needle || (f.name || '').toLowerCase().includes(needle))
    .map((f) => ({ f, m: domainMetrics(f.key || f.name, period) }));

  const overall = {};
  METRICS.forEach((m) => { overall[m.key] = aggregate(shown.map((x) => x.m), m); });
  const metricGrades = METRICS.map((m) => statusFor(m, overall[m.key]));
  const onTarget = metricGrades.filter((g) => g === 'pass').length;
  const measured = metricGrades.filter((g) => g !== 'na').length;
  const verdict = metricGrades.includes('fail') ? 'fail' : metricGrades.includes('warn') ? 'warn' : (measured ? 'pass' : 'na');
  const openIncidents = shown.reduce((s, x) => s + (x.m.incidents || 0), 0);

  const rows = sortRows(shown, sort, DOMAIN_COLS);
  const filtersActive = !!needle || domainSel.size > 0;
  const toggleDomain = (d) => setDomainSel((prev) => { const n = new Set(prev); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  const clearFilters = () => { setQ(''); setDomainSel(new Set()); setStart(isoDay(new Date(Date.now() - 30 * 864e5))); setEnd(isoDay(new Date())); };
  const periodLabel = `${fmtDate(start)} – ${fmtDate(end)}`;

  return (
    <div className="cdp-wrap cdp-qa">
      <button className="cdp-backlink" onClick={() => navigate(`#/report/${data.key}`)}><ArrowLeft size={16} /> Status report</button>

      <section className="cdp-report-hero">
        <div className="rh-top">
          <div>
            <div className="cdp-eyebrow" style={{ color: '#9FC0FF' }}>{data.customer} · Quality Assurance</div>
            <h1><ShieldCheck size={22} style={{ verticalAlign: '-4px', marginRight: 8 }} />QA &amp; SLA report</h1>
            <div className="cust">{data.key} · actuals vs Zyte service levels · {periodLabel}</div>
          </div>
          <div className="cdp-actions" style={{ margin: 0 }}>
            <button className="cdp-btn cdp-btn-ghost" onClick={() => window.print()}><Printer size={15} /> Save / print</button>
          </div>
        </div>
      </section>

      {/* ---- live filters ---- */}
      <div className="cdp-feedfilters" style={{ marginTop: 16 }}>
        <div className="cdp-search">
          <Search size={16} style={{ color: 'var(--slate)' }} />
          <input placeholder="Search domain…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search domains" />
        </div>
        {domainOptions.length > 1 && (
          <DomainDropdown options={domainOptions} selected={domainSel} onToggle={toggleDomain} onClear={() => setDomainSel(new Set())} />
        )}
        <span className="cdp-daterange">
          <Calendar size={15} style={{ color: 'var(--slate)' }} />
          <input type="date" className="cdp-dateinput" value={start} max={end} onChange={(e) => setStart(e.target.value)} aria-label="Start date" />
          <span className="sep">→</span>
          <input type="date" className="cdp-dateinput" value={end} min={start} onChange={(e) => setEnd(e.target.value)} aria-label="End date" />
        </span>
        <span className="cdp-feedcount">{shown.length} of {feeds.length} domains</span>
        {filtersActive && <button className="cdp-linkbtn" onClick={clearFilters}>Clear</button>}
      </div>

      {feeds.length === 0 ? (
        <div className="cdp-emptystate" style={{ marginTop: 8 }}><h3>No domains to report</h3><p>This engagement has no data feeds yet.</p></div>
      ) : shown.length === 0 ? (
        <div className="cdp-emptystate" style={{ marginTop: 8 }}><h3>No domains match</h3><p>Try clearing a filter.</p></div>
      ) : (
        <>
          {/* ---- verdict band ---- */}
          <div className="cdp-qa-verdict">
            <div className={cx('cdp-qa-score', verdict)}>
              <div className="n" style={{ fontSize: 30 }}>{onTarget}/{METRICS.length}</div>
              <div className="l">on target</div>
            </div>
            <div className="cdp-qa-verdict-body">
              <GradeChip grade={verdict}>{verdict === 'pass' ? 'Meeting SLAs' : verdict === 'warn' ? 'Watch — some at risk' : verdict === 'fail' ? 'SLA breach' : 'No data'}</GradeChip>
              <div className="cdp-qa-tally">
                <span><b>{shown.length}</b> domain{shown.length === 1 ? '' : 's'}</span>
                <span><b>{openIncidents}</b> open incident{openIncidents === 1 ? '' : 's'}</span>
                <span>{periodLabel}</span>
                <span className="cdp-qa-live"><span className="cdp-light live" style={{ background: 'var(--rag-green)' }} /> live</span>
              </div>
            </div>
          </div>

          {/* ---- SLA scorecard ---- */}
          <div className="cdp-panel" style={{ marginTop: 16 }}>
            <h4>Service levels <span className="cdp-insight-note">· actual vs Zyte target</span></h4>
            <div style={{ overflowX: 'auto' }}>
              <table className="cdp-schematable">
                <thead><tr><th>Metric</th><th>Definition</th><th>Target</th><th>Actual</th><th>Status</th></tr></thead>
                <tbody>
                  {METRICS.map((m) => {
                    const v = overall[m.key];
                    return (
                      <tr key={m.key}>
                        <td className="cdp-cov-name">{m.label}</td>
                        <td style={{ color: '#33415A' }}>{m.def}</td>
                        <td><span className="cdp-type">{m.target}</span></td>
                        <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{v == null ? '—' : m.fmt(v)}</td>
                        <td><GradeChip grade={statusFor(m, v)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- per-domain breakdown ---- */}
          <div className="cdp-panel" style={{ marginTop: 16 }}>
            <h4>By domain <span className="cdp-insight-note">· {shown.length} shown</span></h4>
            <div style={{ overflowX: 'auto' }}>
              <table className="cdp-table">
                <thead>
                  <tr>
                    <SortHeader col="name" label="Domain" sort={sort} onSort={onSort} />
                    <SortHeader col="coverage" label="Coverage" sort={sort} onSort={onSort} />
                    <SortHeader col="accuracy" label="Field accuracy" sort={sort} onSort={onSort} />
                    <SortHeader col="schema" label="Schema" sort={sort} onSort={onSort} />
                    <SortHeader col="ontime" label="On-time" sort={sort} onSort={onSort} />
                    <SortHeader col="incidents" label="Incidents" sort={sort} onSort={onSort} />
                    <SortHeader col="status" label="Status" sort={sort} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ f, m }) => (
                    <tr key={f.key}>
                      <td className="cdp-feedname">{f.name}</td>
                      <td className="center"><Cell v={m.coverage} g={statusFor(METRICS[0], m.coverage)} suffix="%" /></td>
                      <td className="center"><Cell v={m.accuracy} g={statusFor(METRICS[1], m.accuracy)} suffix="%" /></td>
                      <td className="center"><Cell v={m.schema} g={statusFor(METRICS[3], m.schema)} suffix="%" dp={2} /></td>
                      <td className="center"><Cell v={m.ontime} g={statusFor(METRICS[2], m.ontime)} suffix="%" /></td>
                      <td className="center" style={{ color: m.incidents ? 'var(--rag-red)' : 'inherit', fontWeight: m.incidents ? 700 : 400 }}>{m.incidents || '—'}</td>
                      <td><GradeChip grade={domainStatus(m)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="cdp-note" style={{ marginTop: 12 }}>
            Targets are Zyte’s proposed service levels. Actual figures are <b>representative</b> for this period —
            the live QA/SLA pipeline will replace them per run.
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ v, g, suffix = '', dp = 1 }) {
  const color = g === 'pass' ? 'var(--rag-green)' : g === 'warn' ? 'var(--rag-amber)' : g === 'fail' ? 'var(--rag-red)' : 'var(--slate)';
  return <span style={{ fontWeight: 700, color }}>{v == null ? '—' : `${v.toFixed(dp)}${suffix}`}</span>;
}

// Multi-select domain filter (checkbox list; closes on outside/Esc).
function DomainDropdown({ options, selected, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('keydown', onKey); };
  }, [open]);
  const label = selected.size === 0 ? 'All domains' : `${selected.size} selected`;
  return (
    <div className="cdp-msel" ref={ref}>
      <button type="button" className="cdp-select cdp-msel-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        Domain: {label}
      </button>
      {open && (
        <div className="cdp-msel-pop" role="listbox" aria-multiselectable="true">
          {options.map((o) => (
            <label key={o} className="cdp-msel-opt">
              <input type="checkbox" checked={selected.has(o)} onChange={() => onToggle(o)} />
              <span className="lb">{o}</span>
            </label>
          ))}
          {selected.size > 0 && <button type="button" className="cdp-msel-clear" onClick={onClear}>Clear selection</button>}
        </div>
      )}
    </div>
  );
}
