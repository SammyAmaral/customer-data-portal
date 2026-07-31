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
import { ArrowLeft, RefreshCw, ExternalLink, Search, LayoutGrid, List } from 'lucide-react';
import { fetchWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { useChrome } from '../lib/chrome.jsx';
import { useToast } from '../lib/toast.jsx';
import { TechSkeleton } from '../components/Skeleton.jsx';
import { BarChart } from '../components/charts.jsx';
import { fmtMoney, feedToken, cx } from '../lib/ui.js';
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
  const shownFeeds = needle
    ? feeds.filter((f) => `${f.name} ${f.spiderResolved || f.spiderName || ''}`.toLowerCase().includes(needle))
    : feeds;
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
              {unhealthyJobs > 0 ? ` · ⚠ ${unhealthyJobs} unhealthy` : ''}
            </div>
          </div>
        </div>
        <div className="cdp-actions">
          <button className="cdp-btn cdp-btn-ghost" onClick={() => { setNonce((n) => n + 1); toast.info('Refreshing…'); }}><RefreshCw size={15} /> Refresh</button>
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

function TechList({ feeds, epicKey }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="cdp-table">
        <thead>
          <tr>
            <th>Crawler</th><th>Status</th><th>Items / crawl</th><th>Recent</th><th>Errors</th>
            <th>Last run</th><th>Source</th><th>Schema</th>
          </tr>
        </thead>
        <tbody>
          {feeds.map((f) => {
            const ft = feedToken(f.bucket);
            return (
              <tr key={f.key}>
                <td className="cdp-feedname">{f.name}{f.jobState && (
                  <span className="cdp-jobdot" title={jobStateLabel(f)} style={{ background: jobColor(f) }} />
                )}</td>
                <td><span className="cdp-statuschip" style={{ color: ft.color, background: ft.tint }}>
                  <span className="dot" style={{ background: ft.color }} />{ft.label}</span></td>
                <td className="center">{f.records != null ? fmtMoney(f.records) : '—'}</td>
                <td className="center">{f.recordsRecent != null ? fmtMoney(f.recordsRecent) : '—'}</td>
                <td className="center" style={{ color: f.jobErrors ? 'var(--rag-red)' : 'inherit', fontWeight: f.jobErrors ? 700 : 400 }}>{f.jobErrors != null ? f.jobErrors : '—'}</td>
                <td className="center">{f.jobFinished || '—'}</td>
                <td className="center">{f.jobSource ? <span className="cdp-tag">{f.jobSource === 'prod' ? 'prod' : 'dev'}</span> : '—'}</td>
                <td className="center">{f.jobKey ? <a href={`#/tech/${epicKey}/schema/${encodeURIComponent(f.key)}`}>coverage ↗</a> : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TechCard({ f, epicKey }) {
  const ft = feedToken(f.bucket);
  const cfg = f.config || {};
  const perCrawl = f.records != null ? f.records : null;
  const rpm = runsPerMonth(cfg.frequency);
  const monthly = perCrawl != null && rpm != null ? Math.round(perCrawl * rpm) : null;

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
        <span className="cdp-statuschip" style={{ color: ft.color, background: ft.tint }}>
          <span className="dot" style={{ background: ft.color }} />{ft.label}
        </span>
        {'  '}· {jobStateLabel(f)}
        {f.jobSource && <span className="cdp-tag" title="Which Scrapy Cloud project the jobs came from">{f.jobSource === 'prod' ? 'production' : 'development'}</span>}
      </div>

      <div className="cdp-metrics">
        <div className="cdp-metric">
          <div className="m-n">{perCrawl != null ? fmtMoney(perCrawl) : '—'}</div>
          <div className="m-l">Items / crawl</div>
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
        <dt>Schema</dt>
        <dd>
          {cfg.schema ? <a href={cfg.schema} target="_blank" rel="noreferrer">schema ↗</a> : '—'}
          {f.jobKey && <> · <a href={`#/tech/${epicKey}/schema/${encodeURIComponent(f.key)}`}>coverage</a></>}
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
