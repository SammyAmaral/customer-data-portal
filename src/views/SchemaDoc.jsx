/* =========================================================================
   SchemaDoc — customer-safe rendered data schema for one feed (#/schema/{KEY}/
   {FEED}). Reads /api/schema-doc, which returns either the real JSON-Schema
   fields (from Bitbucket, server-side) or, as a fallback, live field coverage.
   Printable (browser "Save as PDF" / .doc) so the customer never needs the
   private Bitbucket repo.
   ========================================================================= */
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Printer, Braces } from 'lucide-react';
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

export default function SchemaDoc({ epicKey, feedKey }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const { setEngagement } = useChrome();

  // Keep the shell breadcrumb/sidebar in sync (customer-safe: no internal flag).
  useEffect(() => {
    let alive = true;
    fetchWithAuth(`/api/epic?key=${encodeURIComponent(epicKey)}`)
      .then((d) => { if (alive && d) setEngagement({ key: d.key, customer: d.customer, internal: !!d.internal }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [epicKey, setEngagement]);

  useEffect(() => {
    let alive = true;
    setDoc(null); setError(null);
    fetchWithAuth(`/api/schema-doc?feed=${encodeURIComponent(feedKey)}`)
      .then((d) => alive && setDoc(d))
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [feedKey]);

  if (error && error.status === 403) return <AccessDenied message={error.message} />;
  if (error) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <h3>Couldn’t load this schema</h3><p>{error.message}</p>
      <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate(`#/report/${epicKey}`)}><ArrowLeft size={15} /> Status report</button>
    </div></div>;
  }
  if (!doc) return <div className="cdp-center"><div className="cdp-spinner" /></div>;

  const fields = doc.fields || [];
  const isCoverage = doc.source === 'coverage';
  const requiredCount = fields.filter((f) => f.required).length;

  return (
    <div className="cdp-wrap cdp-schemadoc">
      <button className="cdp-backlink" onClick={() => navigate(`#/report/${epicKey}`)}><ArrowLeft size={16} /> Status report</button>

      <section className="cdp-report-hero">
        <div className="rh-top">
          <div>
            <div className="cdp-eyebrow" style={{ color: '#9FC0FF' }}>Data schema</div>
            <h1><Braces size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />{doc.name}</h1>
            <div className="cust">
              {doc.feed}
              {fields.length ? ` · ${fields.length} field${fields.length === 1 ? '' : 's'}` : ''}
              {!isCoverage && requiredCount ? ` · ${requiredCount} required` : ''}
              {isCoverage && doc.total ? ` · ${fmtMoney(doc.total)} sample items` : ''}
            </div>
          </div>
          <div className="cdp-actions" style={{ margin: 0 }}>
            <button className="cdp-btn cdp-btn-ghost" onClick={() => window.print()}><Printer size={15} /> Save / print</button>
          </div>
        </div>
      </section>

      {fields.length === 0 ? (
        <div className="cdp-emptystate" style={{ marginTop: 24 }}>
          <h3>Schema not available yet</h3>
          <p>The data schema for this feed isn’t published yet. It appears here once the feed’s schema is set or its first sample crawl has run.</p>
          {doc.schemaUrl && (
            <p style={{ marginTop: 10 }}><a href={doc.schemaUrl} target="_blank" rel="noreferrer">Open source schema ↗</a> <span className="cdp-tag">internal</span></p>
          )}
        </div>
      ) : (
        <div className="cdp-panel" style={{ marginTop: 16 }}>
          <h4>
            {isCoverage ? `Fields · ${fields.length} (from the latest sample crawl)` : `Schema · ${fields.length} fields`}
            {doc.schemaUrl && <a href={doc.schemaUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', fontSize: 12 }}>source ↗ <span className="cdp-tag">internal</span></a>}
          </h4>

          {isCoverage ? (
            <>
              <p className="cdp-note" style={{ margin: '0 0 14px' }}>
                These are the fields delivered in the most recent sample, with how consistently each one is populated.
              </p>
              <div className="cdp-coverage">
                {fields.map((fld) => (
                  <div className="cdp-cov-row" key={fld.name}>
                    <span className="cdp-cov-name" title={fld.name}>{fld.name}</span>
                    <span className="cdp-cov-track"><span className="cdp-cov-fill" style={{ width: `${fld.pct}%`, background: covColor(fld.pct) }} /></span>
                    <span className="cdp-cov-pct">{fld.pct}%</span>
                    <span className="cdp-cov-count">{fmtMoney(fld.count)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <table className="cdp-schematable">
              <thead>
                <tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr>
              </thead>
              <tbody>
                {fields.map((fld) => (
                  <tr key={fld.name}>
                    <td className="cdp-cov-name">{fld.name}</td>
                    <td><span className="cdp-type">{fld.type}</span></td>
                    <td className="center">{fld.required ? <span className="cdp-req">required</span> : <span style={{ color: 'var(--slate)' }}>optional</span>}</td>
                    <td style={{ color: '#33415A' }}>{fld.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
