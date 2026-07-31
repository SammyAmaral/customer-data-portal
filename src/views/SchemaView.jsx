/* =========================================================================
   SchemaView — internal-only per-feed field-coverage subpage (#/tech/{KEY}/
   schema/{FEED}). Finds the feed on the engagement, then reads live field
   coverage for its latest crawl job from /api/coverage (HubStorage stats),
   mirroring Scrapy Cloud's item field coverage.
   ========================================================================= */
import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { fetchWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { useChrome } from '../lib/chrome.jsx';
import { fmtMoney } from '../lib/ui.js';
import AccessDenied from './AccessDenied.jsx';

function covColor(pct) {
  if (pct >= 90) return 'var(--rag-green)';
  if (pct >= 50) return 'var(--rag-amber)';
  return 'var(--rag-red)';
}

export default function SchemaView({ epicKey, feedKey }) {
  const [epic, setEpic] = useState(null);
  const [cov, setCov] = useState(null);
  const [error, setError] = useState(null);
  const { setEngagement } = useChrome();

  useEffect(() => {
    let alive = true;
    setEpic(null); setCov(null); setError(null);
    fetchWithAuth(`/api/epic?key=${encodeURIComponent(epicKey)}`)
      .then((d) => alive && setEpic(d))
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [epicKey]);

  useEffect(() => {
    if (epic) setEngagement({ key: epic.key, customer: epic.customer, internal: !!epic.internal });
  }, [epic, setEngagement]);

  const feed = epic && (epic.feeds || []).find((f) => f.key === feedKey);
  const jobKey = feed && feed.jobKey;

  useEffect(() => {
    if (!jobKey) return undefined;
    let alive = true;
    setCov(null);
    fetchWithAuth(`/api/coverage?job=${encodeURIComponent(jobKey)}`)
      .then((d) => alive && setCov(d))
      .catch(() => alive && setCov({ ok: false, status: 'error' }));
    return () => { alive = false; };
  }, [jobKey]);

  if (error && error.status === 403) return <AccessDenied message={error.message} />;
  if (error) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <h3>Couldn’t load this view</h3><p>{error.message}</p>
    </div></div>;
  }
  if (!epic) return <div className="cdp-center"><div className="cdp-spinner" /></div>;
  if (!epic.internal) return <AccessDenied message="The technical view is internal-only." />;

  return (
    <div className="cdp-wrap">
      <button className="cdp-backlink" onClick={() => navigate(`#/tech/${epic.key}`)}><ArrowLeft size={16} /> Technical view</button>

      <section className="cdp-report-hero">
        <div className="rh-top"><div>
          <div className="cdp-eyebrow" style={{ color: '#9FC0FF' }}>{epic.customer} · Schema coverage</div>
          <h1>{feed ? feed.name : feedKey}</h1>
          <div className="cust">
            {feed && (feed.spiderResolved || feed.spiderName) ? `Spider ${feed.spiderResolved || feed.spiderName}` : 'Field coverage'}
            {cov && cov.job ? ` · job ${cov.job}` : ''}
            {cov && cov.total ? ` · ${fmtMoney(cov.total)} items` : ''}
          </div>
        </div></div>
      </section>

      {!feed ? (
        <div className="cdp-emptystate" style={{ marginTop: 24 }}><h3>Crawler not found</h3><p>That crawler isn’t part of this engagement.</p></div>
      ) : !jobKey ? (
        <div className="cdp-emptystate" style={{ marginTop: 24 }}><h3>No crawl job yet</h3><p>Field coverage appears once this crawler has run a job.</p></div>
      ) : !cov ? (
        <div className="cdp-center"><div className="cdp-spinner" /></div>
      ) : !cov.ok ? (
        <div className="cdp-note" style={{ marginTop: 16 }}>
          Coverage is unavailable right now ({cov.status || 'error'}). It reads live from Scrapy Cloud’s job stats — try again shortly.
        </div>
      ) : cov.fields.length === 0 ? (
        <div className="cdp-emptystate" style={{ marginTop: 24 }}><h3>No fields</h3><p>The latest job reported no item fields.</p></div>
      ) : (
        <div className="cdp-panel" style={{ marginTop: 16 }}>
          <h4>Field coverage · {cov.fields.length} fields</h4>
          <div className="cdp-coverage">
            {cov.fields.map((fld) => (
              <div className="cdp-cov-row" key={fld.name}>
                <span className="cdp-cov-name" title={fld.name}>{fld.name}</span>
                <span className="cdp-cov-track"><span className="cdp-cov-fill" style={{ width: `${fld.pct}%`, background: covColor(fld.pct) }} /></span>
                <span className="cdp-cov-pct">{fld.pct}%</span>
                <span className="cdp-cov-count">{fmtMoney(fld.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
