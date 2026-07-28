import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, RefreshCw, Link2, Printer, ExternalLink, Hash } from 'lucide-react';
import { fetchWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { fmtDate, fmtMoney, ragToken, feedToken, cx, isNotStarted } from '../lib/ui.js';
import AccessDenied from './AccessDenied.jsx';

export default function Report({ epicKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    fetchWithAuth(`/api/epic?key=${encodeURIComponent(epicKey)}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [epicKey, nonce]);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  }, []);

  if (error && error.status === 403) return <AccessDenied message={error.message} />;
  if (error) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <h3>Couldn’t load this report</h3><p>{error.message}</p>
      <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate('')}><ArrowLeft size={15} /> Back</button>
    </div></div>;
  }
  if (!data) return <div className="cdp-center"><div className="cdp-spinner" /></div>;

  const rt = ragToken(data.rag);
  const phase = data.phase || { index: 0, steps: [] };
  const notStarted = isNotStarted(data.status);
  const current = notStarted ? -1 : phase.index; // -1 → no step active yet

  const feeds = data.feeds || [];
  const pricedFeeds = feeds.filter((f) => f.subscriptionPrice != null);
  const pricedSum = pricedFeeds.reduce((s, f) => s + f.subscriptionPrice, 0);
  const missingPrice = feeds.length - pricedFeeds.length;
  const c = data.commercial || {};
  const hasCommercial = c.setupFee != null || c.mrrValue != null || c.totalContractValue != null || pricedFeeds.length > 0;

  return (
    <div className="cdp-wrap">
      <button className="cdp-backlink" onClick={() => navigate('')}><ArrowLeft size={16} /> All engagements</button>

      {/* ---- hero ---- */}
      <section className="cdp-report-hero">
        <div className="rh-top">
          <div>
            <div className="cdp-eyebrow" style={{ color: '#9FC0FF' }}>{data.customer}</div>
            <h1>{data.name}</h1>
            <div className="cust">Data delivery status · {data.key}{notStarted ? ' · Not started' : ''}</div>
          </div>
          <div className="cdp-biglight">
            <span className="dot" style={{ background: rt.color }} />
            <div><div className="t">Overall health</div><div className="v">{rt.label}</div></div>
          </div>
        </div>
        <div className="cdp-actions">
          <button className="cdp-btn cdp-btn-ghost" onClick={() => setNonce((n) => n + 1)}><RefreshCw size={15} /> Refresh</button>
          <button className="cdp-btn cdp-btn-ghost" onClick={copyLink}><Link2 size={15} /> {copied ? 'Link copied' : 'Copy share link'}</button>
          <button className="cdp-btn cdp-btn-ghost" onClick={() => window.print()}><Printer size={15} /> Export PDF</button>
          {data.internal && data.webUrl && (
            <a className="cdp-btn cdp-btn-ghost" href={data.webUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open in Jira</a>
          )}
        </div>
      </section>

      {/* ---- meta cards ---- */}
      <div className="cdp-metacards">
        <div className="cdp-metacard">
          <h4>Project Details</h4>
          <dl className="cdp-dl">
            <dt>Engagement</dt><dd>{data.key}</dd>
            <dt>Start date</dt><dd>{fmtDate(data.startDate)}</dd>
            <dt>Planned finish</dt><dd>{fmtDate(data.plannedFinish)}</dd>
            <dt>Data feeds</dt><dd>{data.feedCount}</dd>
            {data.effortRag && (<><dt>Effort RAG</dt><dd><Light rag={data.effortRag} /></dd></>)}
          </dl>
          {data.internal && data.internal.links && data.internal.links.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {data.internal.links.map((l) => (
                <a key={l.label} href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {l.label} ↗
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="cdp-metacard">
          <h4>Stakeholders</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px' }}>
            <Person role="Zyte Project Manager" name={data.pm} />
            <Person role="Account Owner" name={data.am} />
            {data.contacts && data.contacts.map((c) => <Person key={c.role} role={c.role} name={c.name} email={c.email} />)}
            {data.internal && data.internal.solutionArchitect && <Person role="Solution Architect" name={data.internal.solutionArchitect} />}
          </div>
          {data.internal && data.internal.slack && (
            <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--slate)' }}>
              <Hash size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{data.internal.slack}
            </div>
          )}
        </div>

        {hasCommercial && (
          <div className="cdp-metacard">
            <h4>Commercial</h4>
            <dl className="cdp-dl">
              <dt>Setup fee</dt><dd>{fmtMoney(c.setupFee)}</dd>
              <dt>Monthly subscription</dt><dd>{fmtMoney(c.mrrValue)}</dd>
              <dt>Contract length</dt><dd>{c.mrrPeriods != null ? `${c.mrrPeriods} months` : '—'}</dd>
              <dt>Total contract value</dt><dd>{fmtMoney(c.totalContractValue)}</dd>
              {data.internal && data.internal.margin != null && (<><dt>Project margin</dt><dd>{data.internal.margin}%</dd></>)}
            </dl>
            {feeds.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--slate)' }}>
                Feeds priced: <b style={{ color: 'var(--ink)' }}>{fmtMoney(pricedSum)}</b>
                {missingPrice > 0 ? ` · ${missingPrice} feed${missingPrice > 1 ? 's' : ''} missing a price` : ''}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- phase stepper ---- */}
      <div className="cdp-stepper">
        {phase.steps.map((label, i) => (
          <div key={label} className={cx('cdp-step', i < current && 'done', i === current && 'current')}>
            <span className="num">{i < current ? '✓' : i + 1}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* ---- narrative (Overview, Scope, Out of Scope, Project Updates) ---- */}
      <div className="cdp-report-narrative">
        <div>
          <NarrativePanel title="Overview" text={data.overview} />
          <ListPanel title="Scope & Assumptions" items={data.scope} />
        </div>
        <div>
          <ListPanel title="Out of Scope" items={data.outOfScope} />
          <ListPanel title="Project Updates" items={data.projectStatus} variant="updates" />
        </div>
      </div>

      {/* ---- feed table (full width, after the narrative) ---- */}
      <div className="cdp-panel cdp-feedpanel">
          <h4>Data Feed Status</h4>
          {data.feeds && data.feeds.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="cdp-table">
                <thead>
                  <tr>
                    <th>Feed</th><th>Status</th><th>Volume band</th><th>Subscription</th>
                    <th>Start date</th><th>1st sample sent</th><th>Sample approved</th><th>Due date</th>
                    <th>Days open</th>
                  </tr>
                </thead>
                <tbody>
                  {data.feeds.map((f) => {
                    const ft = feedToken(f.bucket);
                    return (
                      <tr key={f.key}>
                        <td className="cdp-feedname">{f.name}</td>
                        <td><span className="cdp-statuschip" style={{ color: ft.color, background: ft.tint }}>
                          <span className="dot" style={{ background: ft.color }} />{ft.label}</span></td>
                        <td className="center">{f.volumeBand ? <span className="cdp-band">{f.volumeBand}</span> : '—'}</td>
                        <td className="center">{f.subscriptionPrice != null ? fmtMoney(f.subscriptionPrice) : '—'}</td>
                        <td className="center">{f.startDate ? fmtDate(f.startDate) : '—'}</td>
                        <td className="center">{f.firstSampleSent ? fmtDate(f.firstSampleSent) : '—'}</td>
                        <td className="center">{f.sampleApproved ? fmtDate(f.sampleApproved) : '—'}</td>
                        <td className="center">{f.dueDate ? fmtDate(f.dueDate) : '—'}</td>
                        <td className="center">{f.daysOpen != null ? f.daysOpen : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="cdp-empty">No data feeds recorded on this engagement yet.</div>}
      </div>
    </div>
  );
}

function Person({ role, name, email }) {
  if (!name && !email) return null;
  return (
    <div className="cdp-person">
      <span className="role">{role}</span>
      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{name || '—'}</span>
      {email && <a href={`mailto:${email}`} style={{ fontSize: 12 }}>{email}</a>}
    </div>
  );
}

function Light({ rag }) {
  const t = ragToken(rag);
  return <span className="cdp-rag"><span className="dot" style={{ background: t.color, width: 10, height: 10 }} />{t.label}</span>;
}

function NarrativePanel({ title, text }) {
  return (
    <div className="cdp-panel">
      <h4>{title}</h4>
      {text ? <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: '#33415A' }}>{text}</p>
        : <div className="cdp-empty">Not provided.</div>}
    </div>
  );
}

function ListPanel({ title, items, variant }) {
  return (
    <div className="cdp-panel">
      <h4>{title}</h4>
      {items && items.length > 0
        ? <ul className={cx('cdp-list', variant === 'updates' && 'cdp-updates')}>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
        : <div className="cdp-empty">Not provided.</div>}
    </div>
  );
}
