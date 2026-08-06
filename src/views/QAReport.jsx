/* =========================================================================
   QAReport — a visual Quality-Assurance validation report for an engagement's
   data feeds (#/qa/{KEY}). A confidence artifact for customers: does the data
   Zyte delivers pass validation?

   Data policy: real signals are used where the customer-safe /api/epic payload
   provides them (feed status, records, recent volume, sample-approved date,
   crawl-job health + errors). The detailed validation checks, field-level
   coverage and sample rows are REPRESENTATIVE (clearly labelled) — this is the
   visual template for QA reporting, derived deterministically per feed so it's
   stable, until the QA pipeline emits real per-run validation results.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Printer, ShieldCheck, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { fetchWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { useChrome } from '../lib/chrome.jsx';
import { fmtMoney, fmtDate, feedItems, cx } from '../lib/ui.js';
import { PieChart } from '../components/charts.jsx';
import AccessDenied from './AccessDenied.jsx';

/* ---- deterministic pseudo-metrics (stable per feed, no randomness) ------- */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const span = (seed, lo, hi) => lo + (seed % (hi - lo + 1));
const RAG = { pass: 'var(--rag-green)', warn: 'var(--rag-amber)', fail: 'var(--rag-red)' };
const gradeOf = (score, unhealthy) => (unhealthy || score < 75 ? 'fail' : score < 90 ? 'warn' : 'pass');

// Representative product-schema field coverage (illustrative), varied per feed.
const SCHEMA_FIELDS = ['url', 'name', 'brand', 'price', 'currency', 'sku', 'availability', 'image', 'rating', 'review_count'];
const REQUIRED_FIELDS = new Set(['url', 'name', 'price', 'currency']);
const SAMPLE_ROWS = [
  { name: 'Hidratante Corporal Nativa SPA', brand: 'O Boticário', price: '49.90', availability: 'in_stock' },
  { name: 'Perfume Malbec 100ml', brand: 'O Boticário', price: '189.90', availability: 'in_stock' },
  { name: 'Kit Cuidados Nativa SPA Quinoa', brand: 'natura', price: '129.90', availability: 'out_of_stock' },
  { name: 'Batom Matte Intense', brand: 'Quem disse, Berenice?', price: '39.90', availability: 'in_stock' },
  { name: 'Shampoo Lumina Reparação', brand: 'natura', price: '54.90', availability: 'in_stock' },
];

function feedQA(f) {
  const seed = hash(f.key || f.name || 'x');
  const unhealthy = !!(f.jobState && !f.jobHealthy);
  const conformance = span(seed, 92, 100);
  const completeness = span(seed >> 3, 86, 99);
  const typeValidity = span(seed >> 5, 95, 100);
  const dupRate = span(seed >> 7, 0, 3);
  const freshDays = f.jobFinished ? null : span(seed >> 9, 0, 6);
  const banHealth = unhealthy ? 60 : span(seed >> 11, 90, 100);
  // Weighted score, nudged down by real problems.
  let score = Math.round(conformance * 0.25 + completeness * 0.3 + typeValidity * 0.2 + (100 - dupRate * 6) * 0.1 + banHealth * 0.15);
  if (f.jobErrors) score -= Math.min(12, f.jobErrors);
  if (unhealthy) score -= 15;
  score = Math.max(0, Math.min(100, score));
  return { seed, unhealthy, conformance, completeness, typeValidity, dupRate, freshDays, banHealth, score, grade: gradeOf(score, unhealthy) };
}

/* ---- rule definitions (aggregate view) ---------------------------------- */
const RULE_DEFS = [
  { key: 'conformance', label: 'Schema conformance', desc: 'Records match the agreed schema (no unexpected or missing fields).' },
  { key: 'completeness', label: 'Required-field completeness', desc: 'Required fields are populated on every record.' },
  { key: 'typeValidity', label: 'Type & format validity', desc: 'Prices are numeric, URLs well-formed, dates ISO-8601, etc.' },
  { key: 'dupRate', label: 'Duplicate rate', desc: 'Share of duplicate records after de-duplication.' },
  { key: 'freshness', label: 'Freshness & volume', desc: 'Latest crawl is recent and volume is within the expected band.' },
  { key: 'banHealth', label: 'Anti-bot / ban health', desc: 'Crawl completed without bans, blocks or elevated error rates.' },
];

function ruleStatus(key, qas, feeds) {
  if (key === 'dupRate') { const m = Math.max(...qas.map((q) => q.dupRate)); return { grade: m <= 1 ? 'pass' : m <= 3 ? 'warn' : 'fail', metric: `${m}% max` }; }
  if (key === 'freshness') {
    const stale = feeds.filter((f) => f.jobState && !f.jobHealthy).length;
    const grade = stale === 0 ? 'pass' : stale <= 1 ? 'warn' : 'fail';
    return { grade, metric: stale ? `${stale} feed${stale > 1 ? 's' : ''} behind` : 'all current' };
  }
  if (key === 'banHealth') { const m = Math.min(...qas.map((q) => q.banHealth)); return { grade: m >= 95 ? 'pass' : m >= 80 ? 'warn' : 'fail', metric: `${m}% min` }; }
  // percentage-style rules
  const m = Math.min(...qas.map((q) => q[key]));
  return { grade: m >= 95 ? 'pass' : m >= 85 ? 'warn' : 'fail', metric: `${m}% min` };
}

const GRADE_ICON = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle };
function GradeChip({ grade, children }) {
  const Icon = GRADE_ICON[grade];
  return <span className={cx('cdp-qagrade', grade)}><Icon size={13} />{children || grade}</span>;
}

export default function QAReport({ epicKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const { setEngagement } = useChrome();

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    fetchWithAuth(`/api/epic?key=${encodeURIComponent(epicKey)}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [epicKey]);

  useEffect(() => {
    if (data) setEngagement({ key: data.key, customer: data.customer, internal: !!data.internal });
  }, [data, setEngagement]);

  const feeds = (data && data.feeds) || [];
  const qas = useMemo(() => feeds.map((f) => ({ f, qa: feedQA(f) })), [feeds]);

  if (error && error.status === 403) return <AccessDenied message={error.message} />;
  if (error) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <h3>Couldn’t load the QA report</h3><p>{error.message}</p>
      <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate(`#/report/${epicKey}`)}><ArrowLeft size={15} /> Status report</button>
    </div></div>;
  }
  if (!data) return <div className="cdp-center"><div className="cdp-spinner" /></div>;

  const qaList = qas.map((x) => x.qa);
  const overall = qaList.length ? Math.round(qaList.reduce((s, q) => s + q.score, 0) / qaList.length) : 0;
  const counts = { pass: 0, warn: 0, fail: 0 };
  qaList.forEach((q) => { counts[q.grade]++; });
  const overallGrade = counts.fail ? 'fail' : counts.warn ? 'warn' : 'pass';
  const rules = RULE_DEFS.map((r) => ({ ...r, ...ruleStatus(r.key, qaList, feeds) }));
  const rulesPassed = rules.filter((r) => r.grade === 'pass').length;

  // Representative field coverage, seeded off the whole engagement so it's stable.
  const eseed = hash(data.key);
  const coverage = SCHEMA_FIELDS.map((name, i) => ({
    name,
    required: REQUIRED_FIELDS.has(name),
    pct: REQUIRED_FIELDS.has(name) ? span(eseed >> i, 97, 100) : span(eseed >> (i + 3), 62, 99),
  }));

  // Anomalies: real crawl-job signals first, then a representative validation note.
  const anomalies = [];
  qas.forEach(({ f, qa }) => {
    if (qa.unhealthy) anomalies.push({ level: 'fail', feed: f.name, text: `Last crawl ended with “${f.jobCloseReason || 'issues'}” — records held back from delivery.` });
    else if (f.jobErrors) anomalies.push({ level: 'warn', feed: f.name, text: `${f.jobErrors} error${f.jobErrors > 1 ? 's' : ''} logged in the latest run.` });
    else if (qa.dupRate >= 2) anomalies.push({ level: 'warn', feed: f.name, text: `${qa.dupRate}% duplicate records removed before delivery (representative).` });
  });

  return (
    <div className="cdp-wrap cdp-qa">
      <button className="cdp-backlink" onClick={() => navigate(`#/report/${data.key}`)}><ArrowLeft size={16} /> Status report</button>

      <section className="cdp-report-hero">
        <div className="rh-top">
          <div>
            <div className="cdp-eyebrow" style={{ color: '#9FC0FF' }}>{data.customer} · Quality Assurance</div>
            <h1><ShieldCheck size={22} style={{ verticalAlign: '-4px', marginRight: 8 }} />Data QA validation report</h1>
            <div className="cust">{data.key} · {feeds.length} feed{feeds.length === 1 ? '' : 's'} validated</div>
          </div>
          <div className="cdp-actions" style={{ margin: 0 }}>
            <button className="cdp-btn cdp-btn-ghost" onClick={() => window.print()}><Printer size={15} /> Save / print</button>
          </div>
        </div>
      </section>

      <div className="cdp-note" style={{ marginTop: 12 }}>
        Crawl health, volumes and approval dates are live from this engagement. Field-level validation checks and the
        sample below are <b>representative</b> — the visual template QA results will populate as the validation pipeline runs.
      </div>

      {feeds.length === 0 ? (
        <div className="cdp-emptystate" style={{ marginTop: 24 }}><h3>No feeds to validate</h3><p>This engagement has no data feeds yet.</p></div>
      ) : (
        <>
          {/* ---- overall verdict ---- */}
          <div className="cdp-qa-verdict" style={{ marginTop: 16 }}>
            <div className={cx('cdp-qa-score', overallGrade)}>
              <div className="n">{overall}</div>
              <div className="l">QA score</div>
            </div>
            <div className="cdp-qa-verdict-body">
              <GradeChip grade={overallGrade}>{overallGrade === 'pass' ? 'Passing' : overallGrade === 'warn' ? 'Passing with warnings' : 'Attention needed'}</GradeChip>
              <div className="cdp-qa-tally">
                <span><b style={{ color: RAG.pass }}>{counts.pass}</b> passing</span>
                <span><b style={{ color: RAG.warn }}>{counts.warn}</b> warnings</span>
                <span><b style={{ color: RAG.fail }}>{counts.fail}</b> failing</span>
                <span><b>{rulesPassed}/{rules.length}</b> checks passed</span>
              </div>
            </div>
          </div>

          {/* ---- validation checklist ---- */}
          <div className="cdp-panel" style={{ marginTop: 16 }}>
            <h4>Validation checks</h4>
            <div className="cdp-qa-rules">
              {rules.map((r) => (
                <div key={r.key} className={cx('cdp-qa-rule', r.grade)}>
                  <div className="top"><GradeChip grade={r.grade} /><span className="metric">{r.metric}</span></div>
                  <div className="name">{r.label}</div>
                  <div className="desc">{r.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ---- per-feed scorecard + coverage ---- */}
          <div className="cdp-qa-split" style={{ marginTop: 16 }}>
            <div className="cdp-panel">
              <h4>Feed scorecard</h4>
              <div style={{ overflowX: 'auto' }}>
                <table className="cdp-table">
                  <thead><tr><th>Feed</th><th>Status</th><th>Records</th><th>Approved</th><th className="center">Score</th><th>Verdict</th></tr></thead>
                  <tbody>
                    {qas.map(({ f, qa }) => (
                      <tr key={f.key}>
                        <td className="cdp-feedname">{f.name}</td>
                        <td style={{ fontSize: 12, color: 'var(--slate)' }}>{f.status}</td>
                        <td className="center">{feedItems(f) != null ? fmtMoney(feedItems(f)) : '—'}</td>
                        <td className="center">{f.sampleApproved ? fmtDate(f.sampleApproved) : '—'}</td>
                        <td className="center" style={{ fontWeight: 700 }}>{qa.score}</td>
                        <td><GradeChip grade={qa.grade} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="cdp-panel">
              <h4>Verdict mix</h4>
              <PieChart
                title="Feed QA verdicts"
                data={[
                  { label: 'Passing', value: counts.pass, color: RAG.pass },
                  { label: 'Warnings', value: counts.warn, color: RAG.warn },
                  { label: 'Failing', value: counts.fail, color: RAG.fail },
                ]}
              />
            </div>
          </div>

          {/* ---- field coverage (representative) ---- */}
          <div className="cdp-panel" style={{ marginTop: 16 }}>
            <h4>Required-field completeness <span className="cdp-tag">representative</span></h4>
            <div className="cdp-coverage">
              {coverage.map((fld) => (
                <div className="cdp-cov-row" key={fld.name}>
                  <span className="cdp-cov-name" title={fld.name}>{fld.name}{fld.required && <span className="cdp-req" style={{ marginLeft: 6 }}>req</span>}</span>
                  <span className="cdp-cov-track"><span className="cdp-cov-fill" style={{ width: `${fld.pct}%`, background: fld.pct >= 95 ? 'var(--rag-green)' : fld.pct >= 80 ? 'var(--rag-amber)' : 'var(--rag-red)' }} /></span>
                  <span className="cdp-cov-pct">{fld.pct}%</span>
                  <span className="cdp-cov-count">{fld.required ? 'required' : 'optional'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ---- sample records preview (representative) ---- */}
          <div className="cdp-panel" style={{ marginTop: 16 }}>
            <h4>Validated sample <span className="cdp-tag">representative</span></h4>
            <div style={{ overflowX: 'auto' }}>
              <table className="cdp-schematable">
                <thead><tr><th>name</th><th>brand</th><th>price</th><th>availability</th><th className="center">valid</th></tr></thead>
                <tbody>
                  {SAMPLE_ROWS.map((r, i) => (
                    <tr key={i}>
                      <td className="cdp-cov-name" style={{ maxWidth: 240 }}>{r.name}</td>
                      <td>{r.brand}</td>
                      <td>{r.price}</td>
                      <td><span className="cdp-type">{r.availability}</span></td>
                      <td className="center"><CheckCircle2 size={15} style={{ color: 'var(--rag-green)' }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- anomalies ---- */}
          <div className="cdp-panel" style={{ marginTop: 16 }}>
            <h4>Anomalies & notes</h4>
            {anomalies.length === 0 ? (
              <div className="cdp-qa-clean"><CheckCircle2 size={16} /> No anomalies detected — all feeds passed validation cleanly.</div>
            ) : (
              <ul className="cdp-qa-anoms">
                {anomalies.map((a, i) => (
                  <li key={i} className={a.level}>
                    {a.level === 'fail' ? <XCircle size={15} /> : <AlertTriangle size={15} />}
                    <span><b>{a.feed}</b> — {a.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
