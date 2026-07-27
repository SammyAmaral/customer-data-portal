/* Tiny hash router — no dependency, and its own module so views can import
   navigate() without a circular dependency on App.jsx. */
import { useEffect, useState } from 'react';

export function parseHash() {
  const h = (window.location.hash || '').replace(/^#/, '');
  const m = h.match(/^\/report\/([A-Za-z][A-Za-z0-9]+-\d+)/);
  if (m) return { name: 'report', key: m[1].toUpperCase() };
  return { name: 'portfolio' };
}

export function useHashRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(hash) {
  window.location.hash = hash;
}
