import React, { useEffect, useMemo, useState } from 'react';
import { Search, Layers, LayoutGrid, Table } from 'lucide-react';
import { fetchWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { fmtDate, ragToken, cx, donePct, isNotStarted } from '../lib/ui.js';

// Display label for an engagement's stage: "Not started" while the Epic is
// still To Do, otherwise the derived phase.
function stageLabel(e) {
  if (isNotStarted(e.status)) return 'Not started';
  return e.phase != null ? PHASES[e.phase] : null;
}

const PHASES = ['Project Kickoff', 'Development', 'Q&A', 'Sample & Approval', 'In Production'];
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
];

const monthKey = (e) => (e.plannedFinish ? e.plannedFinish.slice(0, 7) : 'none');
const monthLabel = (k) => {
  if (k === 'none') return 'No finish date';
  const d = new Date(`${k}-01T00:00:00`);
  return isNaN(d) ? k : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};
const ragRank = (rag) => ({ red: 0, amber: 1, green: 2 }[rag] ?? 3);

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

  useEffect(() => {
    let alive = true;
    fetchWithAuth('/api/portfolio')
      .then((d) => {
        if (!alive) return;
        setData(d);
        if (!d.internal && d.engagements.length === 1) navigate(`#/report/${d.engagements[0].key}`);
      })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  const engagements = data ? data.engagements : [];
  const kpis = useMemo(() => summarise(engagements), [engagements]);

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
      if (rag !== 'all' && (e.rag || 'grey') !== rag) return false;
      if (pm !== 'all' && (e.pm || 'Unassigned') !== pm) return false;
      if (phase !== 'all' && String(e.phase) !== phase) return false;
      if (month !== 'all' && monthKey(e) !== month) return false;
      if (needle && !`${e.customer} ${e.summary}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const cmp = {
      updated: (a, b) => (b.updated || '').localeCompare(a.updated || ''),
      finish: (a, b) => (a.plannedFinish || '9999').localeCompare(b.plannedFinish || '9999'),
      customer: (a, b) => a.customer.localeCompare(b.customer),
      delivered: (a, b) => donePct(b.feedCounts) - donePct(a.feedCounts),
      health: (a, b) => ragRank(a.rag) - ragRank(b.rag),
    }[sort];
    return [...filtered].sort(cmp);
  }, [engagements, q, rag, pm, phase, month, sort]);

  if (error) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <h3>Couldn’t load your portfolio</h3><p>{error}</p></div></div>;
  }
  if (!data) return <div className="cdp-center"><div className="cdp-spinner" /></div>;

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
            <Kpi n={kpis.total} l="Engagements" />
            <Kpi n={kpis.inProgress} l="In progress" />
            <Kpi n={kpis.delivered} l="In production" />
            <Kpi n={kpis.dueThisMonth} l="Due this month" alert={kpis.dueThisMonth > 0} />
            <Kpi n={kpis.blockedFeeds} l="Blocked feeds" alert={kpis.blockedFeeds > 0} />
            <Kpi n={kpis.atRisk} l="At risk" alert={kpis.atRisk > 0} />
          </div>
        </div>
      </section>

      <div className="cdp-wrap">
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
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--slate)' }}>{shown.length} of {engagements.length}</span>
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
          <div className="cdp-grid">{shown.map((e) => <EngagementCard key={e.key} e={e} />)}</div>
        ) : (
          <PortfolioTable rows={shown} showPm={isInternal} />
        )}
      </div>
    </div>
  );
}

function Kpi({ n, l, alert }) {
  return <div className={cx('cdp-kpi', alert && 'alert')}><div className="n">{n}</div><div className="l">{l}</div></div>;
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

function EngagementCard({ e }) {
  const rt = ragToken(e.rag);
  const c = e.feedCounts || { total: 0, done: 0, blocked: 0 };
  return (
    <div className="cdp-card" onClick={() => navigate(`#/report/${e.key}`)}>
      <div className="cdp-card-top">
        <div><h3>{e.customer}</h3><div className="sub">{e.summary}</div></div>
        <span className="cdp-rag"><span className="dot" style={{ background: rt.color }} />{rt.label}</span>
      </div>
      {stageLabel(e) && <div><span className={cx('cdp-phasechip', isNotStarted(e.status) && 'muted')}>{stageLabel(e)}</span></div>}
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

function PortfolioTable({ rows, showPm }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="cdp-ptable">
        <thead>
          <tr>
            <th>Customer / engagement</th>
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
              <tr key={e.key} onClick={() => navigate(`#/report/${e.key}`)}>
                <td><div className="cust">{e.customer}</div><div className="eng">{e.summary}</div></td>
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

function summarise(engagements) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let inProgress = 0, delivered = 0, blockedFeeds = 0, atRisk = 0, dueThisMonth = 0;
  for (const e of engagements) {
    if (e.phase === 4) delivered++; else if (e.phase >= 1) inProgress++;
    blockedFeeds += (e.feedCounts && e.feedCounts.blocked) || 0;
    if (e.rag === 'amber' || e.rag === 'red') atRisk++;
    if (e.phase !== 4 && e.plannedFinish && e.plannedFinish.slice(0, 7) === ym) dueThisMonth++;
  }
  return { total: engagements.length, inProgress, delivered, blockedFeeds, atRisk, dueThisMonth };
}
