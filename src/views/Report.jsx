import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, RefreshCw, Link2, Printer, ExternalLink, Hash, Wrench, MessageSquare, X, Check, Send, FileText, Braces, ShieldCheck, Search, Activity } from 'lucide-react';
import { fetchWithAuth, postWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { fmtDate, fmtMoney, ragToken, statusToken, feedToken, feedItems, deliveryPhaseLabel, cx, isNotStarted } from '../lib/ui.js';
import { PieChart, ColumnChart } from '../components/charts.jsx';
import { useChrome } from '../lib/chrome.jsx';
import { useToast } from '../lib/toast.jsx';
import { ReportSkeleton } from '../components/Skeleton.jsx';
import { SortHeader, useSort, sortRows } from '../components/SortHeader.jsx';
import AccessDenied from './AccessDenied.jsx';

export default function Report({ epicKey, email }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [panelFeed, setPanelFeed] = useState(null);   // feed shown in the side panel
  const [panelOpen, setPanelOpen] = useState(false);
  const [feedQ, setFeedQ] = useState('');             // feed-table search
  const [statusSel, setStatusSel] = useState(() => new Set()); // status filter (multi)
  const { sort, onSort, setSort } = useSort();                 // driven by column headers
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
  const totalRecords = feeds.reduce((s, f) => s + (feedItems(f) || 0), 0);
  const unhealthyJobs = feeds.filter((f) => f.jobState && !f.jobHealthy).length;
  const c = data.commercial || {};
  const hasCommercial = c.setupFee != null || c.mrrValue != null || c.totalContractValue != null || pricedFeeds.length > 0;

  // --- charts above the feed table: delivery progress + subscription ramp ---
  const BUCKET_ORDER = ['done', 'review', 'qa', 'progress', 'blocked', 'rejected', 'todo'];
  const bucketCounts = feeds.reduce((m, f) => { const b = f.bucket || 'todo'; m[b] = (m[b] || 0) + 1; return m; }, {});
  const progressData = BUCKET_ORDER.filter((b) => bucketCounts[b]).map((b) => { const t = feedToken(b); return { label: t.label, value: bucketCounts[b], color: t.color }; });
  const liveCount = bucketCounts.done || 0;
  // Subscription $ that has commenced, timed by each feed's Production Delivery Commenced date.
  const commenced = feeds.filter((f) => f.productionCommenced && f.subscriptionPrice != null);
  const liveMRR = commenced.reduce((s, f) => s + f.subscriptionPrice, 0);
  const contractedMRR = c.mrrValue != null ? c.mrrValue : feeds.reduce((s, f) => s + (f.subscriptionPrice || 0), 0);
  const subByMonth = commenced.reduce((m, f) => { const k = f.productionCommenced.slice(0, 7); m[k] = (m[k] || 0) + f.subscriptionPrice; return m; }, {});
  const subRamp = Object.keys(subByMonth).sort().map((k) => ({ key: k, label: monthLabel(k), value: subByMonth[k] }));

  // --- Data Feed Status: search + status multi-filter + sort ---
  const statusList = (() => {
    const m = new Map();
    for (const f of feeds) {
      const s = f.status || 'Unknown';
      const e = m.get(s) || { status: s, category: f.statusCategory, count: 0 };
      e.count++; m.set(s, e);
    }
    return [...m.values()].sort((a, b) => a.status.localeCompare(b.status));
  })();
  const needle = feedQ.trim().toLowerCase();
  const filtered = feeds
    .filter((f) => !needle || (f.name || '').toLowerCase().includes(needle))
    .filter((f) => statusSel.size === 0 || statusSel.has(f.status || 'Unknown'));
  const shownFeeds = sortRows(filtered, sort, FEED_COLS);
  const filtersActive = !!needle || statusSel.size > 0 || !!sort.key;
  const toggleStatus = (s) => setStatusSel((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const clearFilters = () => { setFeedQ(''); setStatusSel(new Set()); setSort({ key: null, dir: 'asc' }); };

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
          <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate(`#/qa/${data.key}`)}><ShieldCheck size={15} /> QA report</button>
          {data.internal && (
            <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate(`#/tech/${data.key}`)}><Wrench size={15} /> Technical view</button>
          )}
          {data.internal && (
            <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate(`#/operations/${data.key}`)}><Activity size={15} /> Operation Status</button>
          )}
          {data.internal && data.webUrl && (
            <a className="cdp-btn cdp-btn-ghost" href={data.webUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open in Jira</a>
          )}
          <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate(`#/change/${data.key}`)}><FileText size={15} /> Change Order</button>
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

        {data.internal && <NotificationsCard epicKey={data.key} contacts={data.contacts} />}
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

      {/* ---- charts: delivery progress + subscription ramp ---- */}
      {feeds.length > 0 && (
        <div className="cdp-insights">
          <div className="cdp-panel">
            <h4>Delivery progress <span className="cdp-insight-note">· {liveCount} of {feeds.length} live in production</span></h4>
            <PieChart data={progressData} title="Delivery progress" />
          </div>
          <div className="cdp-panel">
            <h4>Subscription live <span className="cdp-insight-note">· {fmtMoney(liveMRR, '$')}/mo of {fmtMoney(contractedMRR, '$')}/mo commenced</span></h4>
            {subRamp.length > 0
              ? <ColumnChart data={subRamp} fmt={(v) => fmtMoney(v, '$')} />
              : <div className="cdp-empty">Subscription billing begins as feeds reach Production Delivery Commenced.</div>}
          </div>
        </div>
      )}

      {/* ---- feed table (full width, after the narrative) ---- */}
      <div className="cdp-panel cdp-feedpanel">
          <h4>Data Feed Status</h4>
          {feeds.length > 0 ? (
            <>
              <div className="cdp-feedfilters">
                <div className="cdp-search">
                  <Search size={16} style={{ color: 'var(--slate)' }} />
                  <input placeholder="Search feed name…" value={feedQ} onChange={(e) => setFeedQ(e.target.value)} aria-label="Search feeds" />
                </div>
                {statusList.length > 1 && (
                  <StatusDropdown options={statusList} selected={statusSel} onToggle={toggleStatus} onClear={() => setStatusSel(new Set())} />
                )}
                <span className="cdp-feedcount">{shownFeeds.length} of {feeds.length}</span>
                {filtersActive && <button className="cdp-linkbtn" onClick={clearFilters}>Clear filters</button>}
              </div>
              {shownFeeds.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
              <table className="cdp-table">
                <thead>
                  <tr>
                    <SortHeader col="name" label="Feed" sort={sort} onSort={onSort} />
                    <SortHeader col="status" label="Status" sort={sort} onSort={onSort} />
                    <SortHeader col="band" label="Volume band" sort={sort} onSort={onSort} />
                    <SortHeader col="records" label="Records" sort={sort} onSort={onSort} />
                    <SortHeader col="sub" label="Subscription" sort={sort} onSort={onSort} />
                    <SortHeader col="start" label="Start date" sort={sort} onSort={onSort} />
                    <SortHeader col="sent" label="1st sample sent" sort={sort} onSort={onSort} />
                    <SortHeader col="appr" label="Sample approved" sort={sort} onSort={onSort} />
                    <SortHeader col="due" label="Due date" sort={sort} onSort={onSort} />
                    <SortHeader col="days" label="Days open" sort={sort} onSort={onSort} />
                    <th>Schema · Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {shownFeeds.map((f) => {
                    const st = statusToken(f.statusCategory);
                    const items = feedItems(f);
                    return (
                      <tr key={f.key}>
                        <td className="cdp-feedname">{f.name}{f.jobState && (
                          <span className="cdp-jobdot" title={jobTitle(f)} style={{ background: jobColor(f) }} />
                        )}</td>
                        <td><span className="cdp-statuschip" style={{ color: st.color, background: st.tint }} title={`Jira status: ${f.status}`}>
                          <span className="dot" style={{ background: st.color }} />{f.status}</span></td>
                        <td className="center">{f.volumeBand ? <span className="cdp-band">{f.volumeBand}</span> : '—'}</td>
                        <td className="center">{items != null
                          ? <>{fmtMoney(items)}{f.deliveredPhase && <span className="cdp-src" title={`Items in the ${deliveryPhaseLabel(f.deliveredPhase)} delivered to the customer`}>{f.deliveredPhase === 'full' ? 'FULL' : 'SAMPLE'}</span>}</>
                          : '—'}</td>
                        <td className="center">{f.subscriptionPrice != null
                          ? <>{fmtMoney(f.subscriptionPrice)}{f.priceSource === 'sow' && <span className="cdp-src" title="Filled from the SOW">SOW</span>}</>
                          : '—'}</td>
                        <td className="center">{f.startDate ? fmtDate(f.startDate) : '—'}</td>
                        <td className="center">{f.firstSampleSent ? fmtDate(f.firstSampleSent) : '—'}</td>
                        <td className="center">{f.sampleApproved ? fmtDate(f.sampleApproved) : '—'}</td>
                        <td className="center">{f.dueDate ? fmtDate(f.dueDate) : '—'}</td>
                        <td className="center">{f.daysOpen != null ? f.daysOpen : '—'}</td>
                        <td className="center">
                          <div className="cdp-rowactions">
                            <a className="cdp-iconbtn" href={`#/schema/${data.key}/${encodeURIComponent(f.key)}`} aria-label={`Data schema for ${f.name}`} title="View data schema">
                              <Braces size={15} />
                            </a>
                            <button className="cdp-iconbtn" onClick={() => openFeed(f)} aria-label={`Comments for ${f.name}`} title="Comments & sample approval">
                              <MessageSquare size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              ) : <div className="cdp-empty">No feeds match your search or filters.</div>}
            </>
          ) : <div className="cdp-empty">No data feeds recorded on this engagement yet.</div>}
          {unhealthyJobs > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--rag-red)', fontWeight: 600 }}>
              ⚠ {unhealthyJobs} feed{unhealthyJobs > 1 ? 's' : ''} with a crawl job that didn’t finish cleanly
            </div>
          )}
      </div>

      {/* ---- feed comments / sample-approval side panel (mockup) ----
           Portaled to .cdp-root so position:fixed is relative to the viewport
           (not the transform-animated .cdp-viewport), so it follows page scroll. */}
      {createPortal(
        <>
          {panelOpen && <div className="cdp-panel-backdrop" onClick={closePanel} />}
          <aside className={cx('cdp-sidepanel', panelOpen && 'open')} aria-hidden={!panelOpen}>
            {panelFeed && <FeedPanel key={panelFeed.key} feed={panelFeed} email={email} onClose={closePanel} />}
          </aside>
        </>,
        (typeof document !== 'undefined' && document.querySelector('.cdp-root')) || document.body,
      )}
    </div>
  );
}

const ACCEPTANCE_NOTE = 'By approving this sample you confirm it meets your requirements. This authorises Zyte to complete the crawler and move it to production — starting the recurring delivery and the subscription for this feed.';

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
  const [confirming, setConfirming] = useState(false);

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
  const approve = async () => {
    const a = { by: who, when: new Date().toISOString() };
    setApproval(a); writeJson(apprKey, a);
    try {
      await postWithAuth('/api/approve', { feed: feed.key });
      toast.success('Sample approved — recorded in Jira');
      fetchWithAuth(`/api/comments?feed=${encodeURIComponent(feed.key)}`).then((d) => setRemote(d)).catch(() => {});
    } catch (e) {
      toast.error((e && e.message) || 'Couldn’t record the approval in Jira');
    }
  };

  const remoteComments = (remote && remote.comments) || [];
  const hasAny = remoteComments.length + local.length > 0;

  return (
    <div className="cdp-fp">
      <div className="cdp-fp-head">
        <div>
          <div className="cdp-eyebrow" style={{ color: 'var(--slate)' }}>Feed</div>
          <h3>{feed.name}</h3>
        </div>
        <button className="cdp-fp-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>

      <div className="cdp-fp-preview">Adding a comment here is a <b>preview</b> (not saved yet). Approving the sample <b>posts a comment to Jira</b>.</div>

      <div className="cdp-fp-sample">
        <div className="cdp-fp-sample-row"><span>1st sample sent</span><b>{fmtDate(feed.firstSampleSent)}</b></div>
        <div className="cdp-fp-sample-row"><span>Sample approved</span><b>{feed.sampleApproved ? fmtDate(feed.sampleApproved) : (approval ? 'Approved' : '—')}</b></div>
        {feed.sampleItems != null && <div className="cdp-fp-sample-row"><span>Sample items delivered</span><b>{fmtMoney(feed.sampleItems)}</b></div>}
        {feed.fullItems != null && <div className="cdp-fp-sample-row"><span>Full-crawl items delivered</span><b>{fmtMoney(feed.fullItems)}</b></div>}
        {feed.sampleApproved ? (
          <div className="cdp-fp-approved"><Check size={14} /> Approved in Jira · {fmtDate(feed.sampleApproved)}</div>
        ) : approval ? (
          <div className="cdp-fp-accepted">
            <div className="cdp-fp-approved"><Check size={14} /> Approved by {approval.by} · {fmtDate(approval.when)} — posted to Jira</div>
            <p className="cdp-fp-note">{ACCEPTANCE_NOTE}</p>
          </div>
        ) : confirming ? (
          <div className="cdp-fp-accept">
            <p className="cdp-fp-note">{ACCEPTANCE_NOTE}</p>
            <div className="cdp-fp-accept-actions">
              <button className="cdp-btn cdp-btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="cdp-btn cdp-btn-primary" onClick={() => { approve(); setConfirming(false); }}><Check size={15} /> I accept — approve</button>
            </div>
          </div>
        ) : (
          <button className="cdp-btn cdp-btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setConfirming(true)}><Check size={15} /> Approve sample</button>
        )}
      </div>

      <div className="cdp-fp-comments">
        <h4>Comments</h4>
        {!remote && !failed && <div className="cdp-empty">Loading Jira comments…</div>}
        {failed && <div className="cdp-note" style={{ color: 'var(--rag-amber)', margin: '0 0 10px' }}>Couldn’t load existing Jira comments.</div>}
        {hasAny ? (
          <div className="cdp-cmt-list">
            {remoteComments.map((c) => <Comment key={c.id} c={c} />)}
            {local.map((c, i) => <Comment key={`l${i}`} c={c} />)}
          </div>
        ) : (remote || failed) ? <div className="cdp-empty">No comments yet.</div> : null}
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

const NOTIFY_LEVELS = [
  { key: 'none', label: 'None' },
  { key: 'feedback', label: 'Feedback requests' },
  { key: 'comments_feedback', label: 'Comments + feedback' },
  { key: 'digest', label: 'Daily digest' },
];

function NotificationsCard({ epicKey, contacts }) {
  const toast = useToast();
  const recipients = (contacts || []).map((c) => c.email).filter(Boolean);
  const [level, setLevel] = useState('none');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchWithAuth(`/api/notify-prefs?key=${encodeURIComponent(epicKey)}`)
      .then((d) => { if (alive && d) setLevel(d.level || 'none'); })
      .catch(() => {});
    return () => { alive = false; };
  }, [epicKey]);

  const save = async (lvl) => {
    const prev = level;
    setLevel(lvl); setSaving(true);
    try {
      await postWithAuth('/api/notify-prefs', { key: epicKey, level: lvl, recipients });
      toast.success('Notification settings saved');
    } catch (e) {
      setLevel(prev);
      toast.error((e && e.message) || 'Couldn’t save settings');
    } finally { setSaving(false); }
  };

  return (
    <div className="cdp-metacard">
      <h4>Notifications <span className="cdp-tag">internal</span></h4>
      <div style={{ fontSize: 12.5, color: 'var(--slate)', margin: '-4px 0 12px' }}>
        Email the customer contacts when a feed moves to feedback or gets a comment. (Sending isn’t wired up yet — this saves the preference.)
      </div>
      <div className="cdp-notify-levels">
        {NOTIFY_LEVELS.map((l) => (
          <button key={l.key} type="button" className={cx('cdp-chip', level === l.key && 'active')} onClick={() => save(l.key)} disabled={saving}>{l.label}</button>
        ))}
      </div>
      <div className="cdp-notify-to">
        <span className="lbl">Recipients</span>
        {recipients.length
          ? recipients.map((r) => <span key={r} className="cdp-band">{r}</span>)
          : <span className="cdp-empty">No contact emails on this engagement.</span>}
      </div>
    </div>
  );
}

// Sortable columns for the Data Feed Status table: accessor + value kind.
const FEED_COLS = {
  name:    { get: (f) => f.name, kind: 'str' },
  status:  { get: (f) => f.status, kind: 'str' },
  band:    { get: (f) => f.volumeBand, kind: 'str' },
  records: { get: (f) => feedItems(f), kind: 'num' },
  sub:     { get: (f) => f.subscriptionPrice, kind: 'num' },
  start:   { get: (f) => f.startDate, kind: 'date' },
  sent:    { get: (f) => f.firstSampleSent, kind: 'date' },
  appr:    { get: (f) => f.sampleApproved, kind: 'date' },
  due:     { get: (f) => f.dueDate, kind: 'date' },
  days:    { get: (f) => f.daysOpen, kind: 'num' },
};

// Multi-select status filter dropdown (checkbox list; closes on outside/Esc).
function StatusDropdown({ options, selected, onToggle, onClear }) {
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
  const label = selected.size === 0 ? 'All statuses' : `${selected.size} selected`;
  return (
    <div className="cdp-msel" ref={ref}>
      <button type="button" className="cdp-select cdp-msel-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        Status: {label}
      </button>
      {open && (
        <div className="cdp-msel-pop" role="listbox" aria-multiselectable="true">
          {options.map((s) => {
            const t = statusToken(s.category);
            const on = selected.has(s.status);
            return (
              <label key={s.status} className="cdp-msel-opt">
                <input type="checkbox" checked={on} onChange={() => onToggle(s.status)} />
                <span className="dot" style={{ background: t.color }} />
                <span className="lb">{s.status}</span>
                <span className="n">{s.count}</span>
              </label>
            );
          })}
          {selected.size > 0 && <button type="button" className="cdp-msel-clear" onClick={onClear}>Clear selection</button>}
        </div>
      )}
    </div>
  );
}

// 'YYYY-MM' → "Aug '26".
function monthLabel(k) {
  const d = new Date(`${k}-01T00:00:00`);
  return isNaN(d) ? k : `${d.toLocaleDateString('en-GB', { month: 'short' })} '${k.slice(2, 4)}`;
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
