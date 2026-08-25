/* =========================================================================
   Operations — a live operational board of in-production crawlers (every
   domain whose Status-report status is Done). Reads /api/operations: a
   traffic-light health per crawler, the same telemetry as the Technical view
   framed operationally, and a mocked Freshdesk open-ticket flag. Internal-only.
   ========================================================================= */
import React, { useEffect, useState } from 'react';
import { Search, Activity, Ticket, ExternalLink, RefreshCw } from 'lucide-react';
import { fetchWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { useChrome } from '../lib/chrome.jsx';
import { useToast } from '../lib/toast.jsx';
import { PieChart } from '../components/charts.jsx';
import { SortHeader, useSort, sortRows } from '../components/SortHeader.jsx';
import { fmtMoney, statusToken, cx } from '../lib/ui.js';
import AccessDenied from './AccessDenied.jsx';

const HEALTH = {
  green: { label: 'Live', color: 'var(--rag-green)' },
  amber: { label: 'Degraded', color: 'var(--rag-amber)' },
  red: { label: 'Down', color: 'var(--rag-red)' },
  grey: { label: 'No data', color: 'var(--slate)' },
};
const HEALTH_KEYS = ['green', 'amber', 'red', 'grey'];
const HEALTH_ORDER = { red: 0, amber: 1, grey: 2, green: 3 }; // worst first
const LABEL_TO_HEALTH = { Live: 'green', Degraded: 'amber', Down: 'red', 'No data': 'grey' };

const OPS_COLS = {
  health: { get: (r) => HEALTH_ORDER[r.health] ?? 9, kind: 'num' },
  name: { get: (r) => r.name, kind: 'str' },
  customer: { get: (r) => r.customer, kind: 'str' },
  status: { get: (r) => r.status, kind: 'str' },
  items: { get: (r) => r.records, kind: 'num' },
  errors: { get: (r) => r.jobErrors, kind: 'num' },
  lastrun: { get: (r) => r.jobFinished, kind: 'date' },
  ticket: { get: (r) => (r.freshdesk && r.freshdesk.open ? 1 : 0), kind: 'num' },
};

function relTime(iso) {
  if (!iso) return 'just now';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return 'recently';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

export default function Operations() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [q, setQ] = useState('');
  const [healthSel, setHealthSel] = useState(() => new Set());
  const [ticketsOnly, setTicketsOnly] = useState(false);
  const { sort, onSort } = useSort({ key: 'health', dir: 'asc' }); // worst first
  const { setEngagement } = useChrome();
  const toast = useToast();

  useEffect(() => { setEngagement(null); }, [setEngagement]);
  useEffect(() => {
    let alive = true; setData(null); setError(null);
    fetchWithAuth('/api/operations').then((d) => alive && setData(d)).catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [nonce]);

  if (error && error.status === 403) return <AccessDenied message={error.message} />;
  if (error) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <h3>Couldn’t load Operation Status</h3><p>{error.message}</p></div></div>;
  }
  if (!data) return <div className="cdp-center"><div className="cdp-spinner" /></div>;

  const crawlers = data.crawlers || [];
  const counts = { green: 0, amber: 0, red: 0, grey: 0 };
  crawlers.forEach((c) => { counts[c.health] = (counts[c.health] || 0) + 1; });
  const openTickets = crawlers.filter((c) => c.freshdesk && c.freshdesk.open).length;

  const needle = q.trim().toLowerCase();
  const filtered = crawlers
    .filter((c) => !needle || `${c.name} ${c.customer}`.toLowerCase().includes(needle))
    .filter((c) => healthSel.size === 0 || healthSel.has(c.health))
    .filter((c) => !ticketsOnly || (c.freshdesk && c.freshdesk.open));
  const shown = sortRows(filtered, sort, OPS_COLS);
  const filtersActive = !!needle || healthSel.size > 0 || ticketsOnly;

  const toggleHealth = (h) => setHealthSel((prev) => { const n = new Set(prev); if (n.has(h)) n.delete(h); else n.add(h); return n; });
  const setOnly = (h) => { if (h) setHealthSel(new Set([h])); };
  const clear = () => { setQ(''); setHealthSel(new Set()); setTicketsOnly(false); };
  const refresh = () => { setNonce((n) => n + 1); toast.info('Refreshing…'); };

  const donut = [
    { label: 'Live', value: counts.green, color: 'var(--rag-green)' },
    { label: 'Degraded', value: counts.amber, color: 'var(--rag-amber)' },
    { label: 'Down', value: counts.red, color: 'var(--rag-red)' },
    { label: 'No data', value: counts.grey, color: 'var(--slate)' },
  ].filter((d) => d.value > 0);

  return (
    <div>
      <section className="cdp-hero">
        <div className="cdp-hero-inner">
          <div className="cdp-eyebrow">Zyte · Data on Demand</div>
          <h1>Operation Status</h1>
          <p>Live health of every in-production crawler — what’s live, what’s degraded, what’s down.</p>
          <div className="cdp-kpis">
            <Kpi n={crawlers.length} l="In production" active={!filtersActive} onClick={clear} />
            <Kpi n={counts.green} l="Live" dot="var(--rag-green)" active={healthSel.has('green')} onClick={() => setOnly('green')} />
            <Kpi n={counts.amber} l="Degraded" dot="var(--rag-amber)" alert={counts.amber > 0} active={healthSel.has('amber')} onClick={() => setOnly('amber')} />
            <Kpi n={counts.red} l="Down" dot="var(--rag-red)" alert={counts.red > 0} active={healthSel.has('red')} onClick={() => setOnly('red')} />
            <Kpi n={openTickets} l="Open tickets" alert={openTickets > 0} active={ticketsOnly} onClick={() => setTicketsOnly((v) => !v)} />
          </div>
        </div>
      </section>

      <div className="cdp-wrap">
        {crawlers.length > 0 && (
          <div className="cdp-insights" style={{ gridTemplateColumns: '1fr' }}>
            <div className="cdp-panel">
              <h4>Operational health <span className="cdp-insight-note">· {crawlers.length} in production · updated {relTime(data.checkedAt)}</span>
                <button className="cdp-linkbtn" style={{ marginLeft: 'auto' }} onClick={refresh}><RefreshCw size={13} /> Refresh</button>
              </h4>
              <PieChart data={donut} title="Operational health" onSlice={(label) => setOnly(LABEL_TO_HEALTH[label])} />
            </div>
          </div>
        )}

        <div className="cdp-feedfilters">
          <div className="cdp-search">
            <Search size={16} style={{ color: 'var(--slate)' }} />
            <input placeholder="Search crawler or customer…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search crawlers" />
          </div>
          <div className="cdp-opshealth" role="group" aria-label="Filter by health">
            {HEALTH_KEYS.map((h) => (
              <button key={h} type="button" className={cx('cdp-chip', healthSel.has(h) && 'active')} onClick={() => toggleHealth(h)} aria-pressed={healthSel.has(h)}>
                <span className="cdp-light" style={{ background: HEALTH[h].color }} />{HEALTH[h].label} <span className="n">{counts[h]}</span>
              </button>
            ))}
            <button type="button" className={cx('cdp-chip', ticketsOnly && 'active')} onClick={() => setTicketsOnly((v) => !v)} aria-pressed={ticketsOnly}>
              <Ticket size={13} /> Open tickets <span className="n">{openTickets}</span>
            </button>
          </div>
          <span className="cdp-feedcount">{shown.length} of {crawlers.length}</span>
          {filtersActive && <button className="cdp-linkbtn" onClick={clear}>Clear</button>}
        </div>

        {shown.length === 0 ? (
          <div className="cdp-emptystate">
            <Activity size={28} style={{ color: 'var(--slate)', marginBottom: 10 }} />
            <h3>{crawlers.length === 0 ? 'No crawlers in production yet' : 'No crawlers match your filters'}</h3>
            <p>{crawlers.length === 0 ? 'A domain appears here once its Status-report status is Done.' : 'Try clearing a filter.'}</p>
          </div>
        ) : (
          <div className="cdp-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="cdp-table">
                <thead>
                  <tr>
                    <SortHeader col="health" label="Health" sort={sort} onSort={onSort} />
                    <SortHeader col="name" label="Crawler" sort={sort} onSort={onSort} />
                    <SortHeader col="customer" label="Customer" sort={sort} onSort={onSort} />
                    <SortHeader col="status" label="Status" sort={sort} onSort={onSort} />
                    <SortHeader col="items" label="Items" sort={sort} onSort={onSort} />
                    <SortHeader col="errors" label="Errors" sort={sort} onSort={onSort} />
                    <SortHeader col="lastrun" label="Last run" sort={sort} onSort={onSort} />
                    <SortHeader col="ticket" label="Ticket" sort={sort} onSort={onSort} />
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>{shown.map((c) => <OpsRow key={c.key} c={c} />)}</tbody>
              </table>
            </div>
          </div>
        )}
        {data.truncated && <div className="cdp-note" style={{ marginTop: 10 }}>Showing the {crawlers.length} most recently updated in-production crawlers.</div>}
      </div>
    </div>
  );
}

function OpsRow({ c }) {
  const h = HEALTH[c.health] || HEALTH.grey;
  const st = statusToken(c.statusCategory);
  const fd = c.freshdesk || {};
  const urgent = fd.priority === 'Urgent' || fd.priority === 'High';
  return (
    <tr>
      <td>
        <span className={cx('cdp-light', c.health === 'green' && 'live')} title={h.label} style={{ background: h.color }} />
        <span style={{ fontSize: 12, color: 'var(--slate)', marginLeft: 7 }}>{h.label}</span>
      </td>
      <td className="cdp-feedname">{c.name}</td>
      <td style={{ color: 'var(--slate)' }}>{c.customer}</td>
      <td>
        <span className="cdp-statuschip" style={{ color: st.color, background: st.tint }} title={`Jira status: ${c.status}`}>
          <span className="dot" style={{ background: st.color }} />{c.status}
        </span>
      </td>
      <td className="center">
        {c.records != null ? fmtMoney(c.records) : '—'}
        {c.subCounts && <span className="cdp-tag" title="Sub-crawlers healthy / total">{c.subCounts.healthy}/{c.subCounts.total}</span>}
      </td>
      <td className="center" style={{ color: c.jobErrors ? 'var(--rag-red)' : 'inherit', fontWeight: c.jobErrors ? 700 : 400 }}>{c.jobErrors != null ? c.jobErrors : '—'}</td>
      <td className="center">{c.jobFinished || '—'}</td>
      <td className="center">
        {fd.open
          ? <span className={cx('cdp-fd', urgent && 'urgent')} title={`Freshdesk #${fd.id} · ${fd.priority} · ${fd.subject} (mock)`}><Ticket size={12} /> #{fd.id}</span>
          : <span style={{ color: 'var(--rag-green)' }} title="No open operations ticket">—</span>}
      </td>
      <td className="center">
        <a className="cdp-iconbtn" href={`#/tech/${c.epicKey}`} title="Open technical view" aria-label={`Technical view for ${c.name}`}><ExternalLink size={14} /></a>
      </td>
    </tr>
  );
}

function Kpi({ n, l, dot, alert, active, onClick }) {
  return (
    <button type="button" className={cx('cdp-kpi', alert && 'alert', active && 'active')} onClick={onClick} title={`Filter: ${l}`}>
      <div className="n">{n}</div>
      <div className="l">{dot && <span className="cdp-light" style={{ background: dot, width: 8, height: 8, marginRight: 6, boxShadow: 'none' }} />}{l}</div>
    </button>
  );
}
