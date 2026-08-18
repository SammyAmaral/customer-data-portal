/* =========================================================================
   TechView — internal-only engineering view of an engagement's feeds.

   Reuses /api/epic (which returns feed.config for internal callers and the
   live Scrapy Cloud telemetry already attached to each feed). Renders one
   card per feed: live crawl state + item counts on top, the Jira technical
   configuration below. "Next scheduled run" and running-job ETA are Layer-2
   placeholders — they need the Scrapy Cloud periodic-jobs API, which we wire
   up once the classic job shape is confirmed on a live engagement.
   ========================================================================= */
import React, { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, ExternalLink, Search, LayoutGrid, List, ClipboardCheck } from 'lucide-react';
import { fetchWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { useChrome } from '../lib/chrome.jsx';
import { useToast } from '../lib/toast.jsx';
import { TechSkeleton } from '../components/Skeleton.jsx';
import { BarChart } from '../components/charts.jsx';
import { SortHeader, useSort, sortRows } from '../components/SortHeader.jsx';
import { fmtMoney, statusToken, feedItems, deliveryPhaseLabel, cx } from '../lib/ui.js';
import AccessDenied from './AccessDenied.jsx';

// Delivery frequency → crawl runs per month (for the monthly-items estimate).
const RUNS_PER_MONTH = {
  hourly: 720, daily: 30, weekly: 4, 'bi-weekly': 2, biweekly: 2,
  fortnightly: 2, 'twice a month': 2, monthly: 1, quarterly: 0.33,
  'one-off': 0, 'one off': 0, once: 0, adhoc: 0, 'ad-hoc': 0, 'on demand': 0,
};
function runsPerMonth(freq) {
  const k = String(freq || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(RUNS_PER_MONTH, k) ? RUNS_PER_MONTH[k] : null;
}

function jobColor(f) {
  if (f.jobHealthy) return 'var(--rag-green)';
  if (f.jobState === 'running' || f.jobState === 'pending') return 'var(--amber)';
  return 'var(--rag-red)';
}
const SCRAPY_NOTE = {
  'not-configured': 'Scrapy Cloud isn’t connected yet — cards show the Jira configuration only.',
  'no-projects': 'This Epic has no Scrapy Cloud project or data org set (cf 14254/14255/13556) — cards show the Jira configuration only.',
  'no-projects-in-org': 'No production/development project was found in this engagement’s Scrapy Cloud org — cards show the Jira configuration only.',
  'no-spiders': 'No feed has a spider name (and none could be derived from the site) — cards show the Jira configuration only.',
  'no-jobs': 'The spiders were found but have no crawl jobs in the production or development project yet — cards show the Jira configuration only.',
  error: 'Couldn’t reach Scrapy Cloud — cards show the Jira configuration only.',
};

// Turn the (internal-only) scrapyDebug into a plain-English diagnosis.
function scrapyDiagnostic(status, dbg) {
  if (status === 'ok') return null;
  if (!dbg) return SCRAPY_NOTE[status] || null;
  if (dbg.authRejected) {
    return `The jobs API rejected the key (HTTP ${dbg.httpErrors}). SCRAPYCLOUD_API_KEY needs to be a `
      + `Scrapy Cloud API key whose user can access this org — then redeploy.`;
  }
  if (status === 'no-jobs' && dbg.jobCallsOk > 0) {
    return `The jobs API accepted the key (${dbg.jobCallsOk}/${dbg.jobCalls} calls OK) but returned no jobs `
      + `for any feed's spider name — the Spider Name fields don't match a deployed spider.`;
  }
  if (status === 'no-jobs' && dbg.httpErrors) {
    return `The jobs API returned errors (HTTP ${dbg.httpErrors}) on all ${dbg.jobCalls} calls.`;
  }
  return SCRAPY_NOTE[status] || null;
}

function jobStateLabel(f) {
  if (!f.jobState) return 'No crawl job found';
  if (f.jobState === 'running') return 'Crawling now';
  if (f.jobState === 'pending') return 'Queued to run';
  if (f.jobState === 'finished') return f.jobHealthy ? 'Last crawl OK' : `Last crawl: ${f.jobCloseReason || 'ended with issues'}`;
  return f.jobState;
}

export default function TechView({ epicKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [q, setQ] = useState('');
  const [view, setView] = useState('cards');
  const [alertsOnly, setAlertsOnly] = useState(false);
  const toast = useToast();
  const { setEngagement } = useChrome();

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

  if (error && error.status === 403) return <AccessDenied message={error.message} />;
  if (error) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <h3>Couldn’t load this view</h3><p>{error.message}</p>
      <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate(`#/report/${epicKey}`)}><ArrowLeft size={15} /> Status report</button>
    </div></div>;
  }
  if (!data) return <TechSkeleton />;

  // The technical view is strictly internal — the API only fills feed.config
  // for internal callers, so this is a belt-and-braces client gate too.
  if (!data.internal) return <AccessDenied message="The technical view is internal-only." />;

  const feeds = data.feeds || [];
  const sc = (data.internal && data.internal.scrapy) || {};
  const totalRecords = feeds.reduce((s, f) => s + (f.records || 0), 0);
  const activeJobs = feeds.filter((f) => f.jobState === 'running' || f.jobState === 'pending').length;
  const unhealthyJobs = feeds.filter((f) => f.jobState && !f.jobHealthy).length;
  const needle = q.trim().toLowerCase();
  const hasAlerts = (f) => f.alerts && f.alerts.length > 0;
  const shownFeeds = feeds.filter((f) => {
    if (needle && !`${f.name} ${f.spiderResolved || f.spiderName || ''}`.toLowerCase().includes(needle)) return false;
    if (alertsOnly && !hasAlerts(f)) return false;
    return true;
  });
  const feedsWithAlerts = feeds.filter(hasAlerts).length;
  const totalAlerts = feeds.reduce((n, f) => n + (f.alerts ? f.alerts.length : 0), 0);
  const volumeData = feeds
    .map((f) => ({ label: f.name, value: f.recordsRecent != null ? f.recordsRecent : (f.records || 0), key: f.key }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <div className="cdp-wrap">
      <button className="cdp-backlink" onClick={() => navigate(`#/report/${data.key}`)}><ArrowLeft size={16} /> Status report</button>

      {/* ---- hero ---- */}
      <section className="cdp-report-hero">
        <div className="rh-top">
          <div>
            <div className="cdp-eyebrow" style={{ color: '#9FC0FF' }}>{data.customer} · Internal</div>
            <h1>{data.name} · Technical</h1>
            <div className="cust">Engineering view · {data.key} · {feeds.length} feed{feeds.length === 1 ? '' : 's'}
              {totalRecords > 0 ? ` · ${fmtMoney(totalRecords)} records collected` : ''}
              {activeJobs > 0 ? ` · ${activeJobs} crawling now` : ''}
              {totalAlerts > 0 ? ` · ⚠ ${totalAlerts} alert${totalAlerts > 1 ? 's' : ''} on ${feedsWithAlerts} feed${feedsWithAlerts > 1 ? 's' : ''}` : (unhealthyJobs > 0 ? ` · ⚠ ${unhealthyJobs} unhealthy` : '')}
            </div>
          </div>
        </div>
        <div className="cdp-actions">
          <button className="cdp-btn cdp-btn-ghost" onClick={() => { setNonce((n) => n + 1); toast.info('Refreshing…'); }}><RefreshCw size={15} /> Refresh</button>
          <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate(`#/qa/${data.key}`)}><ClipboardCheck size={15} /> QA report</button>
          {sc.orgUrl && <a className="cdp-btn cdp-btn-ghost" href={sc.orgUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Data org</a>}
          {sc.prodUrl && <a className="cdp-btn cdp-btn-ghost" href={sc.prodUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Prod project</a>}
          {sc.devUrl && <a className="cdp-btn cdp-btn-ghost" href={sc.devUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Dev project</a>}
          {data.webUrl && (
            <a className="cdp-btn cdp-btn-ghost" href={data.webUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open in Jira</a>
          )}
        </div>
      </section>

      {scrapyDiagnostic(data.scrapyStatus, data.scrapyDebug) && (
        <div className="cdp-note" style={{ marginBottom: 4 }}>
          {scrapyDiagnostic(data.scrapyStatus, data.scrapyDebug)}
          {data.scrapyDebug && (
            <span style={{ display: 'block', marginTop: 4, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, opacity: 0.75 }}>
              via {data.scrapyDebug.via} · projects {(data.scrapyDebug.projects || []).join(', ') || '—'} · job calls {data.scrapyDebug.jobCallsOk}/{data.scrapyDebug.jobCalls} OK{data.scrapyDebug.httpErrors ? ` · HTTP ${data.scrapyDebug.httpErrors}` : ''} · {data.scrapyDebug.enriched}/{data.scrapyDebug.spiders} feeds
            </span>
          )}
        </div>
      )}

      {volumeData.length > 1 && (
        <div className="cdp-panel" style={{ marginTop: 4 }}>
          <h4>Crawler volume · recent items collected</h4>
          <BarChart data={volumeData} onBar={(d) => setQ(d.label)} />
        </div>
      )}

      {feeds.length > 0 && (
        <div className="cdp-toolbar" style={{ marginBottom: 14 }}>
          <div className="cdp-search">
            <Search size={16} style={{ color: 'var(--slate)' }} />
            <input placeholder="Search crawl name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="cdp-viewtoggle" role="group" aria-label="View">
            <button className={cx(view === 'cards' && 'active')} onClick={() => setView('cards')}><LayoutGrid size={14} /> Cards</button>
            <button className={cx(view === 'list' && 'active')} onClick={() => setView('list')}><List size={14} /> List</button>
          </div>
          {feedsWithAlerts > 0 && (
            <button className={cx('cdp-chip', alertsOnly && 'active')} onClick={() => setAlertsOnly((v) => !v)}>⚠ Alerts ({feedsWithAlerts})</button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--slate)' }}>{shownFeeds.length} of {feeds.length}</span>
        </div>
      )}

      {feeds.length === 0 ? (
        <div className="cdp-emptystate" style={{ marginTop: 24 }}><h3>No feeds</h3><p>This engagement has no crawling components yet.</p></div>
      ) : shownFeeds.length === 0 ? (
        <div className="cdp-emptystate" style={{ marginTop: 24 }}><h3>No matches</h3><p>No crawlers match “{q}”.</p></div>
      ) : view === 'cards' ? (
        <div className="cdp-techgrid">
          {shownFeeds.map((f) => <TechCard key={f.key} f={f} epicKey={data.key} />)}
        </div>
      ) : (
        <TechList feeds={shownFeeds} epicKey={data.key} />
      )}
    </div>
  );
}

const TECH_COLS = {
  crawler: { get: (f) => f.name, kind: 'str' },
  status:  { get: (f) => f.status, kind: 'str' },
  alerts:  { get: (f) => (f.alerts ? f.alerts.length : 0), kind: 'num' },
  items:   { get: (f) => feedItems(f), kind: 'num' },
  recent:  { get: (f) => f.recordsRecent, kind: 'num' },
  errors:  { get: (f) => f.jobErrors, kind: 'num' },
  lastrun: { get: (f) => f.jobFinished, kind: 'date' },
  source:  { get: (f) => f.jobSource, kind: 'str' },
};

function TechList({ feeds, epicKey }) {
  const { sort, onSort } = useSort();
  const rows = sortRows(feeds, sort, TECH_COLS);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="cdp-table">
        <thead>
          <tr>
            <SortHeader col="crawler" label="Crawler" sort={sort} onSort={onSort} />
            <SortHeader col="status" label="Status" sort={sort} onSort={onSort} />
            <SortHeader col="alerts" label="Alerts" sort={sort} onSort={onSort} />
            <SortHeader col="items" label="Delivered items" sort={sort} onSort={onSort} />
            <SortHeader col="recent" label="Recent" sort={sort} onSort={onSort} />
            <SortHeader col="errors" label="Errors" sort={sort} onSort={onSort} />
            <SortHeader col="lastrun" label="Last run" sort={sort} onSort={onSort} />
            <SortHeader col="source" label="Source" sort={sort} onSort={onSort} />
            <th>Schema</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const st = statusToken(f.statusCategory);
            return (
              <tr key={f.key}>
                <td className="cdp-feedname">{f.name}{f.jobState && (
                  <span className="cdp-jobdot" title={jobStateLabel(f)} style={{ background: jobColor(f) }} />
                )}</td>
                <td><span className="cdp-statuschip" style={{ color: st.color, background: st.tint }} title={`Jira status: ${f.status}`}>
                  <span className="dot" style={{ background: st.color }} />{f.status}</span></td>
                <td>{f.alerts && f.alerts.length ? (
                  <div className="cdp-alerts" style={{ margin: 0 }}>
                    {f.alerts.map((a, i) => <span key={i} className={cx('cdp-alert', a.level)} title={a.code}>{a.label}</span>)}
                  </div>
                ) : <span style={{ color: 'var(--rag-green)' }}>OK</span>}</td>
                <td className="center">{feedItems(f) != null
                  ? <>{fmtMoney(feedItems(f))}{f.deliveredPhase && <span className="cdp-tag" title={`${deliveryPhaseLabel(f.deliveredPhase)} delivered`}>{f.deliveredPhase === 'full' ? 'full' : 'sample'}</span>}</>
                  : '—'}</td>
                <td className="center">{f.recordsRecent != null ? fmtMoney(f.recordsRecent) : '—'}</td>
                <td className="center" style={{ color: f.jobErrors ? 'var(--rag-red)' : 'inherit', fontWeight: f.jobErrors ? 700 : 400 }}>{f.jobErrors != null ? f.jobErrors : '—'}</td>
                <td className="center">{f.jobFinished || '—'}</td>
                <td className="center">{f.jobSource ? <span className="cdp-tag">{f.jobSource === 'prod' ? 'prod' : 'dev'}</span> : '—'}</td>
                <td className="center">{(f.deliveredJobKey || f.jobKey) ? <a href={`#/tech/${epicKey}/schema/${encodeURIComponent(f.key)}`}>coverage ↗</a> : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TechCard({ f, epicKey }) {
  const st = statusToken(f.statusCategory);
  const cfg = f.config || {};
  const delivered = feedItems(f);
  const deliveredLabel = f.deliveredPhase === 'full' ? 'Full-crawl items'
    : f.deliveredPhase === 'sample' ? 'Sample items' : 'Latest crawl items';
  // Monthly estimate tracks the full crawl (the recurring delivery) once known.
  const monthlyBase = f.fullItems != null ? f.fullItems : (f.deliveredItems != null ? f.deliveredItems : f.records);
  const rpm = runsPerMonth(cfg.frequency);
  const monthly = monthlyBase != null && rpm != null ? Math.round(monthlyBase * rpm) : null;

  const complexity = [
    cfg.crawlingComplexity && `crawl ${cfg.crawlingComplexity}`,
    cfg.extractionComplexity && `extract ${cfg.extractionComplexity}`,
    cfg.maintenanceComplexity && `maint ${cfg.maintenanceComplexity}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="cdp-techcard">
      <h3>
        {f.name}
        {f.jobState && <span className="cdp-jobdot" title={jobStateLabel(f)} style={{ background: jobColor(f) }} />}
      </h3>
      <div className="sub">
        <span className="cdp-statuschip" style={{ color: st.color, background: st.tint }} title={`Jira status: ${f.status}`}>
          <span className="dot" style={{ background: st.color }} />{f.status}
        </span>
        {'  '}· {jobStateLabel(f)}
        {f.jobSource && <span className="cdp-tag" title="Which Scrapy Cloud project the jobs came from">{f.jobSource === 'prod' ? 'production' : 'development'}</span>}
        {f.deliveredPhase && <span className="cdp-tag" style={{ color: 'var(--rag-green)', background: 'rgba(14,156,120,.12)' }} title={`This feed's ${deliveryPhaseLabel(f.deliveredPhase)} has been delivered to the customer`}>✓ {f.deliveredPhase} delivered</span>}
      </div>

      {f.alerts && f.alerts.length > 0 && (
        <div className="cdp-alerts">
          {f.alerts.map((a, i) => <span key={i} className={cx('cdp-alert', a.level)} title={a.code}>{a.label}</span>)}
        </div>
      )}

      <div className="cdp-metrics">
        <div className="cdp-metric">
          <div className="m-n">{delivered != null ? fmtMoney(delivered) : '—'}</div>
          <div className="m-l">{deliveredLabel}</div>
        </div>
        <div className="cdp-metric" title={f.jobRuns ? `Sum across the last ${f.jobRuns} runs` : undefined}>
          <div className="m-n">{f.recordsRecent != null ? fmtMoney(f.recordsRecent) : '—'}</div>
          <div className="m-l">{f.jobRuns ? `Items · last ${f.jobRuns} runs` : 'Items · recent'}</div>
        </div>
        <div className="cdp-metric">
          <div className="m-n">{monthly != null ? fmtMoney(monthly) : '—'}</div>
          <div className="m-l">Items / month{monthly != null ? ' est.' : ''}</div>
        </div>
        <div className="cdp-metric">
          <div className="m-n" style={{ color: f.jobErrors ? 'var(--rag-red)' : 'inherit' }}>{f.jobErrors != null ? f.jobErrors : '—'}</div>
          <div className="m-l">Errors{f.jobErrorsRecent ? ` · ${fmtMoney(f.jobErrorsRecent)} recent` : ''}</div>
        </div>
        <div className="cdp-metric">
          <div className="m-n" style={{ fontSize: 13 }}>{f.jobFinished || '—'}</div>
          <div className="m-l">Last run</div>
        </div>
        <div className="cdp-metric" title="Coming with the Scrapy Cloud periodic-jobs integration">
          <div className="m-n" style={{ fontSize: 13, color: 'var(--slate)' }}>Soon</div>
          <div className="m-l">Next run</div>
        </div>
      </div>

      <dl className="cdp-cfg">
        <dt>Sample sent</dt>
        <dd>{f.sampleItems != null ? <>{fmtMoney(f.sampleItems)} items{f.sampleFinished ? ` · ${f.sampleFinished}` : ''}{f.sampleJobUrl && <> · <a href={f.sampleJobUrl} target="_blank" rel="noreferrer">job ↗</a></>}</> : '—'}</dd>
        <dt>Full crawl</dt>
        <dd>{f.fullItems != null ? <>{fmtMoney(f.fullItems)} items{f.fullFinished ? ` · ${f.fullFinished}` : ''}{f.fullJobUrl && <> · <a href={f.fullJobUrl} target="_blank" rel="noreferrer">job ↗</a></>}</> : '—'}</dd>
        <dt>Crawl runs</dt>
        <dd title="Recent crawl jobs seen for this spider (iteration volume)">{f.jobRuns != null ? f.jobRuns : '—'}</dd>
        <dt>Schema</dt>
        <dd>
          {cfg.schema ? <a href={cfg.schema} target="_blank" rel="noreferrer">schema ↗</a> : '—'}
          {(f.deliveredJobKey || f.jobKey) && <> · <a href={`#/tech/${epicKey}/schema/${encodeURIComponent(f.key)}`}>coverage</a></>}
        </dd>
        <dt>Frequency</dt>
        <dd>{cfg.frequency || '—'}</dd>
        <dt>Format</dt>
        <dd>{[cfg.format, cfg.outputType].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Data type</dt>
        <dd>{[cfg.dataType, cfg.region].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Crawler</dt>
        <dd>{[cfg.crawlerType, cfg.zyteProducts].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Anti-bot</dt>
        <dd>{[cfg.antibot, cfg.antibotComplexity].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Complexity</dt>
        <dd>{complexity || '—'}</dd>
        <dt>Req : record</dt>
        <dd>{cfg.requestRatio || '—'}</dd>
        <dt>Post-processing</dt>
        <dd>{cfg.postProcessing || '—'}</dd>
        <dt>Spider</dt>
        <dd style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5 }}>
          {f.jobUrl
            ? <a href={f.jobUrl} target="_blank" rel="noreferrer">{f.spiderResolved || f.spiderName || '—'} ↗</a>
            : (f.spiderResolved || f.spiderName || '—')}
          {f.spiderResolved && !f.spiderName && <span className="cdp-tag" title="Derived from the site domain — no Spider Name set on the feed">derived</span>}
        </dd>
      </dl>
    </div>
  );
}
