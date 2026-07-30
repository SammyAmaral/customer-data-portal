/* =========================================================================
   Skeleton.jsx — shimmer placeholders used while a view's data loads, plus
   per-view compositions that mirror each page's real layout so the transition
   into loaded content is calm (no layout jump, no spinner flash).
   ========================================================================= */
import React from 'react';
import { cx } from '../lib/ui.js';

export function Skeleton({ w, h = 14, r = 8, dark = false, style }) {
  return <span className={cx('cdp-sk', dark && 'on-dark')} style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

const arr = (n) => Array.from({ length: n });

// Portfolio: navy hero + KPI row + a grid of engagement cards.
export function PortfolioSkeleton() {
  return (
    <div>
      <section className="cdp-hero"><div className="cdp-hero-inner">
        <Skeleton w={150} h={11} r={6} dark />
        <div style={{ margin: '12px 0 6px' }}><Skeleton w={280} h={26} r={9} dark /></div>
        <Skeleton w={420} h={13} r={7} dark />
        <div className="cdp-kpis">
          {arr(8).map((_, i) => (
            <div key={i} className="cdp-kpi">
              <Skeleton w={54} h={24} r={7} dark />
              <div style={{ marginTop: 9 }}><Skeleton w={80} h={10} r={6} dark /></div>
            </div>
          ))}
        </div>
      </div></section>
      <div className="cdp-wrap">
        <div style={{ display: 'flex', gap: 10, margin: '22px 0 18px' }}>
          <Skeleton w={300} h={38} r={10} /><Skeleton w={150} h={38} r={10} /><Skeleton w={160} h={38} r={10} />
        </div>
        <div className="cdp-grid">
          {arr(6).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="cdp-card" style={{ cursor: 'default' }}>
      <div className="cdp-card-top">
        <div style={{ flex: 1 }}>
          <Skeleton w="60%" h={17} r={7} />
          <div style={{ marginTop: 8 }}><Skeleton w="85%" h={12} r={6} /></div>
        </div>
        <Skeleton w={80} h={16} r={8} />
      </div>
      <Skeleton w={110} h={20} r={7} />
      <Skeleton w="70%" h={12} r={6} />
      <Skeleton w="100%" h={8} r={5} />
    </div>
  );
}

// Report: hero band + meta cards + stepper + a feed table.
export function ReportSkeleton() {
  return (
    <div className="cdp-wrap">
      <div style={{ padding: '16px 0 12px' }}><Skeleton w={130} h={14} r={7} /></div>
      <div className="cdp-report-hero"><div style={{ position: 'relative', zIndex: 1 }}>
        <Skeleton w={160} h={11} r={6} dark />
        <div style={{ margin: '10px 0 6px' }}><Skeleton w={320} h={24} r={9} dark /></div>
        <Skeleton w={220} h={13} r={7} dark />
        <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
          {arr(3).map((_, i) => <Skeleton key={i} w={120} h={34} r={9} dark />)}
        </div>
      </div></div>
      <div className="cdp-metacards">
        {arr(3).map((_, i) => (
          <div key={i} className="cdp-metacard">
            <Skeleton w={130} h={12} r={6} />
            <div style={{ display: 'grid', gap: 11, marginTop: 16 }}>
              {arr(4).map((__, j) => <Skeleton key={j} w={`${90 - j * 8}%`} h={12} r={6} />)}
            </div>
          </div>
        ))}
      </div>
      <div className="cdp-stepper" style={{ padding: 18, gap: 24 }}>
        {arr(5).map((_, i) => <Skeleton key={i} w="18%" h={26} r={8} />)}
      </div>
      <div className="cdp-panel" style={{ marginTop: 16 }}>
        <Skeleton w={160} h={13} r={6} />
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          {arr(5).map((_, i) => <Skeleton key={i} w="100%" h={16} r={6} />)}
        </div>
      </div>
    </div>
  );
}

// Technical view: hero + a grid of feed cards.
export function TechSkeleton() {
  return (
    <div className="cdp-wrap">
      <div style={{ padding: '16px 0 12px' }}><Skeleton w={130} h={14} r={7} /></div>
      <div className="cdp-report-hero"><div style={{ position: 'relative', zIndex: 1 }}>
        <Skeleton w={180} h={11} r={6} dark />
        <div style={{ margin: '10px 0 6px' }}><Skeleton w={340} h={24} r={9} dark /></div>
        <Skeleton w={260} h={13} r={7} dark />
      </div></div>
      <div className="cdp-techgrid">
        {arr(4).map((_, i) => (
          <div key={i} className="cdp-techcard">
            <Skeleton w="55%" h={15} r={7} />
            <div style={{ margin: '10px 0 14px' }}><Skeleton w="40%" h={12} r={6} /></div>
            <div className="cdp-metrics">
              {arr(6).map((__, j) => <Skeleton key={j} w="100%" h={44} r={10} />)}
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {arr(5).map((__, j) => <Skeleton key={j} w="100%" h={13} r={6} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
