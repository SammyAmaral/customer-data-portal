/* =========================================================================
   charts.jsx — small hand-rolled SVG charts (no dependency).

   PieChart  — a donut for part-to-whole identity (e.g. engagements per PM).
   BarChart  — horizontal magnitude bars (e.g. crawler volumes).

   Colour: the donut uses the Okabe-Ito categorical palette — a well-known
   colour-vision-deficiency-safe set (Okabe & Ito, 2008), fixed order, capped
   with an "Other" bucket (this repo has no local Node to run the dataviz
   validator, so a literature-validated palette is used by construction). The
   bar chart is single-hue (magnitude), per the dataviz form rules. Identity is
   never colour-alone: the donut ships a legend, the bars are directly labelled.
   ========================================================================= */
import React from 'react';
import { cx } from '../lib/ui.js';

// Okabe-Ito categorical order (CVD-safe), + a neutral for the "Other" bucket.
export const CAT = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9'];
const OTHER = '#8A97A8';

const nfmt = (n) => Number(n).toLocaleString('en-US');

function polar(cx0, cy0, r, angle) {
  const a = ((angle - 90) * Math.PI) / 180;
  return [cx0 + r * Math.cos(a), cy0 + r * Math.sin(a)];
}
function donutSlice(cx0, cy0, R, r, a0, a1) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polar(cx0, cy0, R, a0);
  const [x1, y1] = polar(cx0, cy0, R, a1);
  const [x2, y2] = polar(cx0, cy0, r, a1);
  const [x3, y3] = polar(cx0, cy0, r, a0);
  return `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
}

// data: raw [{label, value}] (unsorted ok). Caps to `max` slices + "Other".
export function PieChart({ data, size = 172, max = 6, onSlice, title = 'Distribution' }) {
  const clean = (data || []).filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const total = clean.reduce((s, d) => s + d.value, 0);
  if (!total) return <div className="cdp-empty">No data to chart.</div>;

  const head = clean.slice(0, max);
  const tail = clean.slice(max);
  const slices = head.map((d, i) => ({ ...d, color: CAT[i % CAT.length] }));
  if (tail.length) slices.push({ label: 'Other', value: tail.reduce((s, d) => s + d.value, 0), color: OTHER, tail });

  const R = size / 2;
  const r = R * 0.58;
  const cx0 = R;
  const cy0 = R;
  let acc = 0;
  const single = slices.length === 1;

  return (
    <div className="cdp-chart-row">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`${title}: ${slices.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
        {single ? (
          <>
            <circle cx={cx0} cy={cy0} r={(R + r) / 2} fill="none" stroke={slices[0].color} strokeWidth={R - r} />
          </>
        ) : slices.map((s) => {
          const a0 = (acc / total) * 360;
          acc += s.value;
          const a1 = (acc / total) * 360;
          const btn = !!onSlice;
          return (
            <path key={s.label} d={donutSlice(cx0, cy0, R - 1, r, a0, a1)} fill={s.color}
              stroke="#fff" strokeWidth="2" style={btn ? { cursor: 'pointer' } : undefined}
              onClick={btn ? () => onSlice(s.label) : undefined}>
              <title>{`${s.label}: ${nfmt(s.value)} (${Math.round((s.value / total) * 100)}%)`}</title>
            </path>
          );
        })}
        <text x={cx0} y={cy0 - 4} textAnchor="middle" className="cdp-chart-center-n">{nfmt(total)}</text>
        <text x={cx0} y={cy0 + 12} textAnchor="middle" className="cdp-chart-center-l">total</text>
      </svg>
      <ul className="cdp-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <button type="button" className={cx('cdp-legend-item', onSlice && s.label !== 'Other' && 'clickable')}
              onClick={onSlice && s.label !== 'Other' ? () => onSlice(s.label) : undefined}
              disabled={!onSlice || s.label === 'Other'}>
              <span className="sw" style={{ background: s.color }} />
              <span className="lb">{s.label}</span>
              <span className="vl">{s.value}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// data: [{label, value, key?}] — caller sorts. Single-hue magnitude bars.
export function BarChart({ data, onBar, unit = '', max = 20 }) {
  const rows = (data || []).slice(0, max);
  const peak = rows.reduce((m, d) => Math.max(m, d.value || 0), 0) || 1;
  if (!rows.length) return <div className="cdp-empty">No volume data yet.</div>;
  return (
    <div className="cdp-barchart">
      {rows.map((d) => {
        const pct = Math.max(2, Math.round(((d.value || 0) / peak) * 100));
        const clickable = !!onBar;
        return (
          <div key={d.key || d.label} className={cx('cdp-bar-row', clickable && 'clickable')}
            role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onBar(d) : undefined}
            onKeyDown={clickable ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onBar(d); } } : undefined}>
            <span className="cdp-bar-label" title={d.label}>{d.label}</span>
            <span className="cdp-bar-track"><span className="cdp-bar-fill" style={{ width: `${pct}%` }} /></span>
            <span className="cdp-bar-val">{d.value != null ? nfmt(d.value) : '—'}{unit}</span>
          </div>
        );
      })}
    </div>
  );
}
