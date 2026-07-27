import React, { useEffect, useMemo, useState } from 'react';
import { Search, Layers } from 'lucide-react';
import { fetchWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { fmtDate, ragToken, cx, donePct } from '../lib/ui.js';

const RAG_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'green', label: 'On track' },
  { key: 'amber', label: 'At risk' },
  { key: 'red', label: 'Off track' },
];

export default function Portfolio() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [rag, setRag] = useState('all');

  useEffect(() => {
    let alive = true;
    fetchWithAuth('/api/portfolio')
      .then((d) => {
        if (!alive) return;
        setData(d);
        // A customer with exactly one engagement goes straight to their report.
        if (!d.internal && d.engagements.length === 1) navigate(`#/report/${d.engagements[0].key}`);
      })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  const engagements = data ? data.engagements : [];
  const kpis = useMemo(() => summarise(engagements), [engagements]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return engagements.filter((e) => {
      if (rag !== 'all' && (e.rag || 'grey') !== rag) return false;
      if (needle && !(`${e.customer} ${e.summary}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [engagements, q, rag]);

  if (error) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <h3>Couldn’t load your portfolio</h3><p>{error}</p></div></div>;
  }
  if (!data) return <div className="cdp-center"><div className="cdp-spinner" /></div>;

  const isInternal = data.internal;
  const title = isInternal ? 'Delivery Portfolio' : 'Your Data Delivery';
  const subtitle = isInternal
    ? 'Live status across active Data on Demand engagements — click any customer to open their report.'
    : 'The live status of your Zyte data delivery engagement(s).';

  return (
    <div>
      <section className="cdp-hero">
        <div className="cdp-hero-inner">
          <div className="cdp-eyebrow">Zyte · Data on Demand</div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          <div className="cdp-kpis">
            <Kpi n={kpis.total} l="Engagements" />
            <Kpi n={kpis.inProgress} l="In progress" />
            <Kpi n={kpis.delivered} l="In production" />
            <Kpi n={kpis.blockedFeeds} l="Blocked feeds" alert={kpis.blockedFeeds > 0} />
            <Kpi n={kpis.atRisk} l="At risk" alert={kpis.atRisk > 0} />
          </div>
        </div>
      </section>

      <div className="cdp-wrap">
        <div className="cdp-toolbar">
          <div className="cdp-search">
            <Search size={16} style={{ color: 'var(--slate)' }} />
            <input placeholder="Search customer or project…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {RAG_FILTERS.map((f) => (
              <button key={f.key} className={cx('cdp-chip', rag === f.key && 'active')} onClick={() => setRag(f.key)}>{f.label}</button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--slate)' }}>
            {filtered.length} of {engagements.length}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="cdp-emptystate">
            <Layers size={28} style={{ color: 'var(--slate)', marginBottom: 10 }} />
            <h3>Nothing to show</h3>
            <p>{engagements.length === 0 ? 'No engagements are shared with your account yet.' : 'No engagements match your filters.'}</p>
          </div>
        ) : (
          <div className="cdp-grid">
            {filtered.map((e) => <EngagementCard key={e.key} e={e} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ n, l, alert }) {
  return <div className={cx('cdp-kpi', alert && 'alert')}><div className="n">{n}</div><div className="l">{l}</div></div>;
}

function EngagementCard({ e }) {
  const rt = ragToken(e.rag);
  const c = e.feedCounts || { total: 0, done: 0, blocked: 0 };
  const done = donePct(c);
  const blocked = c.total ? Math.round((c.blocked / c.total) * 100) : 0;
  const phaseLabel = e.phase != null ? PHASES[e.phase] : null;
  return (
    <div className="cdp-card" onClick={() => navigate(`#/report/${e.key}`)}>
      <div className="cdp-card-top">
        <div>
          <h3>{e.customer}</h3>
          <div className="sub">{e.summary}</div>
        </div>
        <span className="cdp-rag"><span className="dot" style={{ background: rt.color }} />{rt.label}</span>
      </div>

      {phaseLabel && <div><span className="cdp-phasechip">{phaseLabel}</span></div>}

      <div className="cdp-meta-row">
        <span>PM <b>{e.pm || '—'}</b></span>
        <span>Finish <b>{fmtDate(e.plannedFinish)}</b></span>
      </div>

      <div>
        <div className="cdp-progress">
          <i style={{ width: `${done}%`, background: 'var(--rag-green)' }} />
          <i style={{ width: `${blocked}%`, background: 'var(--rag-red)' }} />
          <i style={{ width: `${100 - done - blocked}%`, background: 'var(--line)' }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--slate)', marginTop: 6 }}>
          {c.done}/{c.total} feeds delivered{c.blocked ? ` · ${c.blocked} blocked` : ''}
        </div>
      </div>
    </div>
  );
}

const PHASES = ['Project Kickoff', 'Development', 'Q&A', 'Sample & Approval', 'In Production'];

function summarise(engagements) {
  let inProgress = 0, delivered = 0, blockedFeeds = 0, atRisk = 0;
  for (const e of engagements) {
    if (e.phase === 4) delivered++; else if (e.phase >= 1) inProgress++;
    blockedFeeds += (e.feedCounts && e.feedCounts.blocked) || 0;
    if (e.rag === 'amber' || e.rag === 'red') atRisk++;
  }
  return { total: engagements.length, inProgress, delivered, blockedFeeds, atRisk };
}
