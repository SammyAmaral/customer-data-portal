import React, { useEffect, useMemo, useState } from 'react';
import { Search, Layers, LayoutGrid, Table, X, Lock } from 'lucide-react';
import { fetchWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { useChrome } from '../lib/chrome.jsx';
import { PortfolioSkeleton } from '../components/Skeleton.jsx';
import { PieChart, TimelineChart } from '../components/charts.jsx';
import { fmtDate, ragToken, statusToken, cx, donePct, isNotStarted } from '../lib/ui.js';

// Activate a clickable non-button element (card / row) from the keyboard.
const onActivate = (fn) => (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fn(); } };

// Display label for an engagement's stage: "Not started" while the Epic is
// still To Do, otherwise the derived phase.
function stageLabel(e) {
  if (isNotStarted(e.status)) return 'Not started';
  return e.phase != null ? PHASES[e.phase] : null;
}

const PHASES = ['Project Kickoff', 'Development', 'Quality Assurance (QA)', 'Sample & Approval', 'Production Run'];
const RAG_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'green', label: 'On track' },
  { key: 'amber', label: 'At risk' },
  { key: 'red', label: 'Off track' },
];
const SORTS = [
  { key: 'updated', label: 'Recently updated' },
  { key: 'finish', label: 'Finish date (soonest)' },
  { key: 'customer', label: 'Customer A–Z' },
  { key: 'delivered', label: '% delivered (high→low)' },
  { key: 'health', label: 'Health (worst first)' },
  { key: 'alerts', label: 'Most crawler alerts' },
];

const KPI_LABELS = {
  notStarted: 'Not started', inProgress: 'In progress', awaiting: 'Awaiting feedback',
  inProduction: 'In production', overdue: 'Overdue', atRisk: 'At risk', alerts: 'Crawler alerts',
};

const monthKey = (e) => (e.plannedFinish ? e.plannedFinish.slice(0, 7) : 'none');
const monthLabel = (k) => {
  if (k === 'none') return 'No finish date';
  const d = new Date(`${k}-01T00:00:00`);
  return isNaN(d) ? k : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};
const ragRank = (rag) => ({ red: 0, amber: 1, green: 2 }[rag] ?? 3);
const monthShort = (k) => {
  if (k === 'none') return 'No date';
  const d = new Date(`${k}-01T00:00:00`);
  return isNaN(d) ? k : `${d.toLocaleDateString('en-GB', { month: 'short' })} '${k.slice(2, 4)}`;
};
// Health donut slice label → RAG filter key (for click-to-filter).
const RAG_BY_LABEL = { 'On track': 'green', 'At risk': 'amber', 'Off track': 'red', 'Not set': 'grey' };

export default function Portfolio() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [rag, setRag] = useState('all');
  const [pm, setPm] = useState('all');
  const [phase, setPhase] = useState('all');
  const [month, setMonth] = useState('all');
  const [sort, setSort] = useState('updated');
  const [view, setView] = useState('cards');
  const [kpi, setKpi] = useState(null); // active KPI filter key, or null
  const [alertsMap, setAlertsMap] = useState({}); // per-engagement crawler-alert rollup
  const { setEngagement } = useChrome();

  // On the portfolio there's no open engagement — reset the breadcrumb.
  useEffect(() => { setEngagement(null); }, [setEngagement]);

  useEffect(() => {
    let alive = true;
    fetchWithAuth('/api/portfolio')
      .then((d) => {
        if (!alive) return;
        setData(d);
        if (!d.internal && d.engagements.length === 1) navigate(`#/report/${d.engagements[0].key}`);
      })
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, []);

  // Crawler-alert rollup (internal-only; empty for customers) — layered on
  // after the main load so the portfolio itself stays fast.
  useEffect(() => {
    let alive = true;
    fetchWithAuth('/api/alerts')
      .then((d) => { if (alive && d && d.byEpic) setAlertsMap(d.byEpic); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const engagements = data ? data.engagements : [];

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const preds = useMemo(() => ({
    notStarted: (e) => isNotStarted(e.status),
    inProgress: (e) => !isNotStarted(e.status) && e.phase >= 1 && e.phase < 4,
    awaiting: (e) => (e.feedCounts ? e.feedCounts.review : 0) > 0,
    inProduction: (e) => e.phase === 4,
    overdue: (e) => e.plannedFinish && e.plannedFinish < today && e.phase !== 4,
    atRisk: (e) => e.rag === 'amber' || e.rag === 'red',
    alerts: (e) => { const r = alertsMap[e.key]; return !!(r && (r.high > 0 || r.alertFeeds > 0)); },
  }), [today, alertsMap]);

  const metrics = useMemo(() => {
    const m = { total: engagements.length, notStarted: 0, inProgress: 0, awaiting: 0, inProduction: 0, overdue: 0, atRisk: 0, alertEng: 0, feedsDone: 0, feedsTotal: 0 };
    for (const e of engagements) {
      if (preds.notStarted(e)) m.notStarted++;
      if (preds.inProgress(e)) m.inProgress++;
      if (preds.awaiting(e)) m.awaiting++;
      if (preds.inProduction(e)) m.inProduction++;
      if (preds.overdue(e)) m.overdue++;
      if (preds.atRisk(e)) m.atRisk++;
      if (preds.alerts(e)) m.alertEng++;
      const fc = e.feedCounts || {};
      m.feedsDone += fc.done || 0;
      m.feedsTotal += fc.total || 0;
    }
    m.completion = m.feedsTotal ? Math.round((m.feedsDone / m.feedsTotal) * 100) : 0;
    return m;
  }, [engagements, preds]);

  const pmChartData = useMemo(() => {
    const m = {};
    for (const e of engagements) { const k = e.pm || 'Unassigned'; m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).map(([label, value]) => ({ label, value }));
  }, [engagements]);

  const healthData = useMemo(() => {
    const m = { green: 0, amber: 0, red: 0, grey: 0 };
    for (const e of engagements) { const k = e.rag || 'grey'; m[k] = (m[k] || 0) + 1; }
    return [
      { label: 'On track', value: m.green, color: 'var(--rag-green)' },
      { label: 'At risk', value: m.amber, color: 'var(--rag-amber)' },
      { label: 'Off track', value: m.red, color: 'var(--rag-red)' },
      { label: 'Not set', value: m.grey, color: 'var(--slate)' },
    ].filter((d) => d.value > 0);
  }, [engagements]);

  const timelineData = useMemo(() => {
    const nowM = today.slice(0, 7);
    const m = {};
    for (const e of engagements) {
      const k = monthKey(e);
      if (!m[k]) m[k] = { key: k, value: 0, customers: [] };
      m[k].value += 1;
      m[k].customers.push(e.customer);
    }
    return Object.values(m)
      .sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.key.localeCompare(b.key)))
      .map((d) => ({
        ...d,
        label: monthShort(d.key),
        color: d.key === 'none' ? 'var(--slate)' : d.key < nowM ? 'var(--rag-red)' : d.key === nowM ? 'var(--rag-amber)' : 'var(--blue)',
      }));
  }, [engagements, today]);
  const undated = (timelineData.find((d) => d.key === 'none') || {}).value || 0;

  const noFilters = kpi === null && rag === 'all' && pm === 'all' && phase === 'all' && month === 'all' && !q.trim();
  const onKpi = (key) => {
    if (key === 'all') { setKpi(null); setRag('all'); setPm('all'); setPhase('all'); setMonth('all'); setQ(''); return; }
    setKpi((prev) => (prev === key ? null : key));
  };

  const pmOptions = useMemo(
    () => [...new Set(engagements.map((e) => e.pm || 'Unassigned'))].sort((a, b) => a.localeCompare(b)),
    [engagements],
  );
  const monthOptions = useMemo(() => {
    const keys = [...new Set(engagements.map(monthKey))];
    return keys.sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : b.localeCompare(a)));
  }, [engagements]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = engagements.filter((e) => {
      if (kpi && preds[kpi] && !preds[kpi](e)) return false;
      if (rag !== 'all' && (e.rag || 'grey') !== rag) return false;
      if (pm !== 'all' && (e.pm || 'Unassigned') !== pm) return false;
      if (phase !== 'all' && String(e.phase) !== phase) return false;
      if (month !== 'all' && monthKey(e) !== month) return false;
      if (needle && !`${e.customer} ${e.summary}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const aScore = (e) => { const r = alertsMap[e.key]; return r ? r.high * 100 + (r.warn || 0) : -1; };
    const cmp = {
      updated: (a, b) => (b.updated || '').localeCompare(a.updated || ''),
      finish: (a, b) => (a.plannedFinish || '9999').localeCompare(b.plannedFinish || '9999'),
      customer: (a, b) => a.customer.localeCompare(b.customer),
      delivered: (a, b) => donePct(b.feedCounts) - donePct(a.feedCounts),
      health: (a, b) => ragRank(a.rag) - ragRank(b.rag),
      alerts: (a, b) => aScore(b) - aScore(a),
    }[sort];
    return [...filtered].sort(cmp);
  }, [engagements, q, rag, pm, phase, month, sort, kpi, preds, alertsMap]);

  if (error && error.status === 403) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <Lock size={30} style={{ color: 'var(--slate)', marginBottom: 12 }} />
      <h3>Restricted to Zyte staff</h3>
      <p style={{ maxWidth: 440, margin: '0 auto' }}>{error.message}</p>
    </div></div>;
  }
  if (error) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <h3>Couldn’t load your portfolio</h3><p>{error.message || String(error)}</p></div></div>;
  }
  if (!data) return <PortfolioSkeleton />;

  const isInternal = data.internal;

  return (
    <div>
      <section className="cdp-hero">
        <div className="cdp-hero-inner">
          <div className="cdp-eyebrow">Zyte · Data on Demand</div>
          <h1>{isInternal ? 'Delivery Portfolio' : 'Your Data Delivery'}</h1>
          <p>{isInternal
            ? 'Live status across active Data on Demand engagements — click any customer to open their report.'
            : 'The live status of your Zyte data delivery engagement(s).'}</p>
          <div className="cdp-kpis">
            <Kpi n={metrics.total} l="Engagements" active={noFilters} onClick={() => onKpi('all')} />
            <Kpi n={metrics.notStarted} l="Not started" active={kpi === 'notStarted'} onClick={() => onKpi('notStarted')} />
            <Kpi n={metrics.inProgress} l="In progress" active={kpi === 'inProgress'} onClick={() => onKpi('inProgress')} />
            <Kpi n={metrics.awaiting} l="Awaiting feedback" active={kpi === 'awaiting'} onClick={() => onKpi('awaiting')} />
            <Kpi n={metrics.inProduction} l="In production" active={kpi === 'inProduction'} onClick={() => onKpi('inProduction')} />
            <Kpi n={metrics.overdue} l="Overdue" alert={metrics.overdue > 0} active={kpi === 'overdue'} onClick={() => onKpi('overdue')} />
            <Kpi n={metrics.atRisk} l="At risk" alert={metrics.atRisk > 0} active={kpi === 'atRisk'} onClick={() => onKpi('atRisk')} />
            {isInternal && <Kpi n={metrics.alertEng} l="Crawler alerts" alert={metrics.alertEng > 0} active={kpi === 'alerts'} onClick={() => onKpi('alerts')} />}
            <KpiPct pct={metrics.completion} />
          </div>
        </div>
      </section>

      <div className="cdp-wrap">
        {isInternal && engagements.length > 0 && (
          <div className="cdp-insights">
            <div className="cdp-panel">
              <h4>Portfolio health</h4>
              <PieChart data={healthData} title="Portfolio health"
                onSlice={(label) => { const r = RAG_BY_LABEL[label]; if (r) setRag(r); }} />
            </div>
            <div className="cdp-panel">
              <h4>Engagements by project manager</h4>
              <PieChart data={pmChartData} title="Engagements by PM"
                onSlice={(name) => { if (name !== 'Other') setPm(name); }} />
            </div>
            <div className="cdp-panel cdp-insight-wide">
              <h4>Finishing timeline <span className="cdp-insight-note">· red past due · amber this month · blue upcoming</span></h4>
              <TimelineChart data={timelineData} onStop={(d) => setMonth(d.key)} />
              {undated > 0 && <div className="cdp-note" style={{ marginTop: 8 }}>{undated} engagement{undated > 1 ? 's' : ''} without a finish date.</div>}
            </div>
          </div>
        )}
        {/* row 1: search · view · sort */}
        <div className="cdp-toolbar">
          <div className="cdp-search">
            <Search size={16} style={{ color: 'var(--slate)' }} />
            <input placeholder="Search customer or project…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="cdp-viewtoggle" role="group" aria-label="View">
            <button className={cx(view === 'cards' && 'active')} onClick={() => setView('cards')}><LayoutGrid size={14} /> Cards</button>
            <button className={cx(view === 'table' && 'active')} onClick={() => setView('table')}><Table size={14} /> Table</button>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--slate)', fontSize: 12.5 }}>Sort</span>
            <select className="cdp-select" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {kpi && <button className="cdp-kpiclear" onClick={() => setKpi(null)}>{KPI_LABELS[kpi]} <X size={13} /></button>}
            <span style={{ fontSize: 12.5, color: 'var(--slate)' }}>{shown.length} of {engagements.length}</span>
          </div>
        </div>

        {/* row 2: filters */}
        <div className="cdp-controls">
          {RAG_FILTERS.map((f) => (
            <button key={f.key} className={cx('cdp-chip', rag === f.key && 'active')} onClick={() => setRag(f.key)}>{f.label}</button>
          ))}
          {isInternal && (
            <select className="cdp-select" value={pm} onChange={(e) => setPm(e.target.value)} aria-label="Filter by PM">
              <option value="all">All PMs</option>
              {pmOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <select className="cdp-select" value={phase} onChange={(e) => setPhase(e.target.value)} aria-label="Filter by phase">
            <option value="all">All phases</option>
            {PHASES.map((p, i) => <option key={i} value={String(i)}>{p}</option>)}
          </select>
          <select className="cdp-select" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Filter by finish month">
            <option value="all">All months</option>
            {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>

        {shown.length === 0 ? (
          <div className="cdp-emptystate">
            <Layers size={28} style={{ color: 'var(--slate)', marginBottom: 10 }} />
            <h3>Nothing to show</h3>
            <p>{engagements.length === 0 ? 'No engagements are shared with your account yet.' : 'No engagements match your filters.'}</p>
          </div>
        ) : view === 'cards' ? (
          <div className="cdp-grid">{shown.map((e) => <EngagementCard key={e.key} e={e} rollup={alertsMap[e.key]} />)}</div>
        ) : (
          <PortfolioTable rows={shown} showPm={isInternal} alerts={alertsMap} />
        )}
      </div>
    </div>
  );
}

function StatusPill({ status, category }) {
  const t = statusToken(category);
  return (
    <span className="cdp-statuschip" style={{ color: t.color, background: t.tint }}>
      <span className="dot" style={{ background: t.color }} />{status || '—'}
    </span>
  );
}

// Consolidated crawler-alert badge for the portfolio (rolled up from the
// engineer view). Null when an engagement has no alerts / hasn't been checked.
function AlertBadge({ rollup }) {
  if (!rollup) return null;
  const n = (rollup.high || 0) + (rollup.warn || 0);
  if (!n) return null;
  return (
    <span className={cx('cdp-alert', rollup.high > 0 ? 'high' : 'warn')}
      title={`${rollup.high || 0} critical · ${rollup.warn || 0} warning on ${rollup.alertFeeds} feed${rollup.alertFeeds > 1 ? 's' : ''}`}>
      ⚠ {n}
    </span>
  );
}

function Kpi({ n, l, alert, active, onClick }) {
  return (
    <button type="button" className={cx('cdp-kpi', alert && 'alert', active && 'active')} onClick={onClick} title={`Filter: ${l}`}>
      <div className="n">{n}</div><div className="l">{l}</div>
    </button>
  );
}

function KpiPct({ pct }) {
  return (
    <div className="cdp-kpi">
      <div className="n">{pct}%</div>
      <div className="l">Feed completion</div>
      <div className="cdp-kpibar"><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function ProgressBar({ counts }) {
  const c = counts || { total: 0, done: 0, blocked: 0 };
  const done = donePct(c);
  const blocked = c.total ? Math.round((c.blocked / c.total) * 100) : 0;
  return (
    <div className="cdp-minibar">
      <i style={{ width: `${done}%`, background: 'var(--rag-green)' }} />
      <i style={{ width: `${blocked}%`, background: 'var(--rag-red)' }} />
      <i style={{ width: `${Math.max(0, 100 - done - blocked)}%`, background: 'var(--line)' }} />
    </div>
  );
}

function EngagementCard({ e, rollup }) {
  const rt = ragToken(e.rag);
  const c = e.feedCounts || { total: 0, done: 0, blocked: 0 };
  return (
    <div className="cdp-card" role="button" tabIndex={0}
      onClick={() => navigate(`#/report/${e.key}`)}
      onKeyDown={onActivate(() => navigate(`#/report/${e.key}`))}>
      <div className="cdp-card-top">
        <div><h3>{e.customer}</h3><div className="sub">{e.summary}</div></div>
        <span className="cdp-rag"><span className="dot" style={{ background: rt.color }} />{rt.label}</span>
      </div>
      <div className="cdp-chip-row">
        <StatusPill status={e.status} category={e.statusCategory} />
        {stageLabel(e) && <span className={cx('cdp-phasechip', isNotStarted(e.status) && 'muted')}>{stageLabel(e)}</span>}
        <AlertBadge rollup={rollup} />
      </div>
      <div className="cdp-meta-row"><span>PM <b>{e.pm || '—'}</b></span><span>Finish <b>{fmtDate(e.plannedFinish)}</b></span></div>
      <div>
        <ProgressBar counts={c} />
        <div style={{ fontSize: 12, color: 'var(--slate)', marginTop: 6 }}>
          {c.done}/{c.total} feeds delivered{c.blocked ? ` · ${c.blocked} blocked` : ''}
        </div>
      </div>
    </div>
  );
}

function PortfolioTable({ rows, showPm, alerts }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="cdp-ptable">
        <thead>
          <tr>
            <th>Customer / engagement</th>
            <th>Status</th>
            <th>Phase</th>
            <th>Health</th>
            {showPm && <th>PM</th>}
            <th>Finish</th>
            <th className="num">Delivered</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const rt = ragToken(e.rag);
            const c = e.feedCounts || { total: 0, done: 0 };
            return (
              <tr key={e.key} role="button" tabIndex={0}
                onClick={() => navigate(`#/report/${e.key}`)}
                onKeyDown={onActivate(() => navigate(`#/report/${e.key}`))}>
                <td><div className="cust">{e.customer}</div><div className="eng">{e.summary}</div></td>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><StatusPill status={e.status} category={e.statusCategory} /><AlertBadge rollup={alerts && alerts[e.key]} /></div></td>
                <td>{stageLabel(e) ? <span className={cx('cdp-phasechip', isNotStarted(e.status) && 'muted')}>{stageLabel(e)}</span> : '—'}</td>
                <td><span className="cdp-rag"><span className="dot" style={{ background: rt.color }} />{rt.label}</span></td>
                {showPm && <td style={{ fontSize: 12.5 }}>{e.pm || '—'}</td>}
                <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtDate(e.plannedFinish)}</td>
                <td>
                  <ProgressBar counts={c} />
                  <div style={{ fontSize: 11.5, color: 'var(--slate)', marginTop: 5, textAlign: 'center' }}>{c.done}/{c.total}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

