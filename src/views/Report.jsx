import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, RefreshCw, Link2, Printer, ExternalLink, Hash, Wrench, MessageSquare, X, Check, Send } from 'lucide-react';
import { fetchWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { fmtDate, fmtMoney, ragToken, feedToken, cx, isNotStarted } from '../lib/ui.js';
import { useChrome } from '../lib/chrome.jsx';
import { useToast } from '../lib/toast.jsx';
import { ReportSkeleton } from '../components/Skeleton.jsx';
import AccessDenied from './AccessDenied.jsx';

export default function Report({ epicKey, email }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [panelFeed, setPanelFeed] = useState(null);   // feed shown in the side panel
  const [panelOpen, setPanelOpen] = useState(false);
  const toast = useToast();
  const { setEngagement } = useChrome();

  const openFeed = (f) => { setPanelFeed(f); setPanelOpen(true); };
  const closePanel = useCallback(() => { setPanelOpen(false); setTimeout(() => setPanelFeed(null), 250); }, []);
  useEffect(() => {
    if (!panelOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closePanel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, closePanel]);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    fetchWithAuth(`/api/epic?key=${encodeURIComponent(epicKey)}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [epicKey, nonce]);

  // Feed the shell breadcrumb / sidebar once the engagement loads.
  useEffect(() => {
    if (data) setEngagement({ key: data.key, customer: data.customer, internal: !!data.internal });
  }, [data, setEngagement]);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => toast.success('Share link copied'))
      .catch(() => toast.error('Couldn’t copy the link'));
  }, [toast]);

  if (error && error.status === 403) return <AccessDenied message={error.message} />;
  if (error) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <h3>Couldn’t load this report</h3><p>{error.message}</p>
      <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate('')}><ArrowLeft size={15} /> Back</button>
    </div></div>;
  }
  if (!data) return <ReportSkeleton />;

  const rt = ragToken(data.rag);
  const phase = data.phase || { index: 0, steps: [] };
  const notStarted = isNotStarted(data.status);
  const current = notStarted ? -1 : phase.index; // -1 → no step active yet

  const feeds = data.feeds || [];
  const pricedFeeds = feeds.filter((f) => f.subscriptionPrice != null);
  const pricedSum = pricedFeeds.reduce((s, f) => s + f.subscriptionPrice, 0);
  const missingPrice = feeds.length - pricedFeeds.length;
  const totalRecords = feeds.reduce((s, f) => s + (f.records || 0), 0);
  const unhealthyJobs = feeds.filter((f) => f.jobState && !f.jobHealthy).length;
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
          <button className="cdp-btn cdp-btn-ghost" onClick={() => { setNonce((n) => n + 1); toast.info('Refreshing…'); }}><RefreshCw size={15} /> Refresh</button>
          <button className="cdp-btn cdp-btn-ghost" onClick={copyLink}><Link2 size={15} /> Copy share link</button>
          <button className="cdp-btn cdp-btn-ghost" onClick={() => window.print()}><Printer size={15} /> Export PDF</button>
          {data.internal && (
            <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate(`#/tech/${data.key}`)}><Wrench size={15} /> Technical view</button>
          )}
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
            {totalRecords > 0 && (<><dt>Records delivered</dt><dd>{fmtMoney(totalRecords)}</dd></>)}
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

      {/* ---- narrative: Project Updates (full width) → Overview / Scope / Out of Scope / Change Requests ---- */}
      <div className="cdp-report-updates">
        <ListPanel title="Project Updates" items={data.projectStatus} variant="updates" empty="No updates logged yet." />
      </div>
      <div className="cdp-report-narrative">
        <div>
          <NarrativePanel title="Overview" text={data.overview} />
          <ListPanel title="Scope & Assumptions" items={data.scope} />
        </div>
        <div>
          <ListPanel title="Out of Scope" items={data.outOfScope} />
          <ListPanel title="Change Requests" items={data.changeRequests} empty="No change requests logged." />
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
                    <th>Feed</th><th>Status</th><th>Volume band</th><th>Records</th><th>Subscription</th>
                    <th>Start date</th><th>1st sample sent</th><th>Sample approved</th><th>Due date</th>
                    <th>Days open</th><th>Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {data.feeds.map((f) => {
                    const ft = feedToken(f.bucket);
                    return (
                      <tr key={f.key}>
                        <td className="cdp-feedname">{f.name}{f.jobState && (
                          <span className="cdp-jobdot" title={jobTitle(f)} style={{ background: jobColor(f) }} />
                        )}</td>
                        <td><span className="cdp-statuschip" style={{ color: ft.color, background: ft.tint }}>
                          <span className="dot" style={{ background: ft.color }} />{ft.label}</span></td>
                        <td className="center">{f.volumeBand ? <span className="cdp-band">{f.volumeBand}</span> : '—'}</td>
                        <td className="center">{f.records != null ? fmtMoney(f.records) : '—'}</td>
                        <td className="center">{f.subscriptionPrice != null
                          ? <>{fmtMoney(f.subscriptionPrice)}{f.priceSource === 'sow' && <span className="cdp-src" title="Filled from the SOW">SOW</span>}</>
                          : '—'}</td>
                        <td className="center">{f.startDate ? fmtDate(f.startDate) : '—'}</td>
                        <td className="center">{f.firstSampleSent ? fmtDate(f.firstSampleSent) : '—'}</td>
                        <td className="center">{f.sampleApproved ? fmtDate(f.sampleApproved) : '—'}</td>
                        <td className="center">{f.dueDate ? fmtDate(f.dueDate) : '—'}</td>
                        <td className="center">{f.daysOpen != null ? f.daysOpen : '—'}</td>
                        <td className="center">
                          <button className="cdp-iconbtn" onClick={() => openFeed(f)} aria-label={`Comments for ${f.name}`} title="Comments & sample approval">
                            <MessageSquare size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="cdp-empty">No data feeds recorded on this engagement yet.</div>}
          {unhealthyJobs > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--rag-red)', fontWeight: 600 }}>
              ⚠ {unhealthyJobs} feed{unhealthyJobs > 1 ? 's' : ''} with a crawl job that didn’t finish cleanly
            </div>
          )}
      </div>

      {/* ---- feed comments / sample-approval side panel (mockup) ---- */}
      {panelOpen && <div className="cdp-panel-backdrop" onClick={closePanel} />}
      <aside className={cx('cdp-sidepanel', panelOpen && 'open')} aria-hidden={!panelOpen}>
        {panelFeed && <FeedPanel key={panelFeed.key} feed={panelFeed} email={email} onClose={closePanel} />}
      </aside>
    </div>
  );
}

function readJson(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

function FeedPanel({ feed, email, onClose }) {
  const toast = useToast();
  const [remote, setRemote] = useState(null); // { comments } | null (loading)
  const [failed, setFailed] = useState(false);
  const storeKey = `cdp_cmt_${feed.key}`;
  const apprKey = `cdp_appr_${feed.key}`;
  const [local, setLocal] = useState(() => readJson(storeKey, []));
  const [approval, setApproval] = useState(() => readJson(apprKey, null));
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let alive = true;
    setRemote(null); setFailed(false);
    fetchWithAuth(`/api/comments?feed=${encodeURIComponent(feed.key)}`)
      .then((d) => alive && setRemote(d))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [feed.key]);

  const who = email || 'You';
  const addComment = () => {
    const text = draft.trim();
    if (!text) return;
    const next = [...local, { author: who, when: new Date().toISOString(), lines: text.split('\n').filter(Boolean), preview: true }];
    setLocal(next); writeJson(storeKey, next); setDraft('');
    toast.success('Comment added (preview)');
  };
  const approve = () => {
    const a = { by: who, when: new Date().toISOString() };
    setApproval(a); writeJson(apprKey, a);
    toast.success('Sample marked approved (preview)');
  };
  const undoApprove = () => { setApproval(null); writeJson(apprKey, null); };

  const remoteComments = (remote && remote.comments) || [];
  const empty = !failed && remote && remoteComments.length === 0 && local.length === 0;

  return (
    <div className="cdp-fp">
      <div className="cdp-fp-head">
        <div>
          <div className="cdp-eyebrow" style={{ color: 'var(--slate)' }}>Feed</div>
          <h3>{feed.name}</h3>
        </div>
        <button className="cdp-fp-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>

      <div className="cdp-fp-preview">Comments &amp; approval are a <b>preview</b> — kept in your browser, not saved to Jira yet.</div>

      <div className="cdp-fp-sample">
        <div className="cdp-fp-sample-row"><span>1st sample sent</span><b>{fmtDate(feed.firstSampleSent)}</b></div>
        <div className="cdp-fp-sample-row"><span>Sample approved</span><b>{feed.sampleApproved ? fmtDate(feed.sampleApproved) : (approval ? 'Approved (preview)' : '—')}</b></div>
        {feed.sampleApproved ? (
          <div className="cdp-fp-approved"><Check size={14} /> Approved in Jira · {fmtDate(feed.sampleApproved)}</div>
        ) : approval ? (
          <div className="cdp-fp-approved"><Check size={14} /> Approved by {approval.by} · {fmtDate(approval.when)} <button className="cdp-linkbtn" onClick={undoApprove}>undo</button></div>
        ) : (
          <button className="cdp-btn cdp-btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={approve}><Check size={15} /> Approve sample</button>
        )}
      </div>

      <div className="cdp-fp-comments">
        <h4>Comments</h4>
        {failed ? <div className="cdp-empty">Couldn’t load comments from Jira.</div>
          : !remote ? <div className="cdp-empty">Loading…</div>
          : empty ? <div className="cdp-empty">No comments yet.</div>
          : (
            <div className="cdp-cmt-list">
              {remoteComments.map((c) => <Comment key={c.id} c={c} />)}
              {local.map((c, i) => <Comment key={`l${i}`} c={c} />)}
            </div>
          )}
      </div>

      <div className="cdp-fp-composer">
        <textarea placeholder="Add a comment about this feed…" value={draft} rows={3} onChange={(e) => setDraft(e.target.value)} />
        <button className="cdp-btn cdp-btn-primary" style={{ justifyContent: 'center' }} onClick={addComment} disabled={!draft.trim()}>
          <Send size={15} /> Add comment
        </button>
      </div>
    </div>
  );
}

function Comment({ c }) {
  const lines = c.lines && c.lines.length ? c.lines : ['—'];
  return (
    <div className="cdp-cmt">
      <div className="cdp-cmt-top">
        <span className="cdp-cmt-author">{c.author}{c.preview && <span className="cdp-tag">preview</span>}</span>
        <span className="cdp-cmt-when">{fmtDate(c.when)}</span>
      </div>
      {lines.map((l, i) => <p key={i} className="cdp-cmt-body">{l}</p>)}
    </div>
  );
}

function jobColor(f) {
  if (f.jobHealthy) return 'var(--rag-green)';
  if (f.jobState === 'running' || f.jobState === 'pending') return 'var(--amber)';
  return 'var(--rag-red)';
}
function jobTitle(f) {
  const parts = [`Crawl job: ${f.jobState || 'unknown'}`];
  if (f.jobCloseReason && f.jobCloseReason !== f.jobState) parts.push(f.jobCloseReason);
  if (f.records != null) parts.push(`${Number(f.records).toLocaleString('en-US')} records`);
  if (f.jobFinished) parts.push(`finished ${f.jobFinished}`);
  if (f.jobErrors) parts.push(`${f.jobErrors} error${f.jobErrors > 1 ? 's' : ''}`);
  return parts.join(' · ');
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

function ListPanel({ title, items, variant, empty }) {
  return (
    <div className="cdp-panel">
      <h4>{title}</h4>
      {items && items.length > 0
        ? <ul className={cx('cdp-list', variant === 'updates' && 'cdp-updates')}>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
        : <div className="cdp-empty">{empty || 'Not provided.'}</div>}
    </div>
  );
}
