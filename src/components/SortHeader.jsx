/* =========================================================================
   SortHeader — a clickable, sortable table header + the small sort helpers
   shared by the Data Feed Status table (Report) and the Technical list view.

   A "column def" is { get(row) -> value, kind: 'str' | 'num' | 'date' }. Pass a
   map of them (keyed by column id) to sortRows(); click a header to sort by
   that column, click again to flip direction. Empty values always sort last.
   ========================================================================= */
import React, { useState } from 'react';

export function useSort(initial = { key: null, dir: 'asc' }) {
  const [sort, setSort] = useState(initial);
  const onSort = (key) => setSort((p) => (p.key === key
    ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' }));
  return { sort, onSort, setSort };
}

export function compareBy(a, b, col, dir) {
  if (!col) return 0;
  const va = col.get(a);
  const vb = col.get(b);
  const ea = va == null || va === '';
  const eb = vb == null || vb === '';
  if (ea && eb) return 0;
  if (ea) return 1;   // empties always last, both directions
  if (eb) return -1;
  let r;
  if (col.kind === 'num') r = Number(va) - Number(vb);
  else if (col.kind === 'date') r = new Date(va) - new Date(vb);
  else r = String(va).localeCompare(String(vb));
  return dir === 'desc' ? -r : r;
}

// Returns a sorted copy; with no active key returns the rows untouched.
export function sortRows(rows, sort, columns) {
  if (!sort || !sort.key) return rows;
  const col = columns[sort.key];
  if (!col) return rows;
  return [...rows].sort((a, b) => compareBy(a, b, col, sort.dir));
}

export function SortHeader({ col, label, sort, onSort, className }) {
  const active = sort.key === col;
  return (
    <th className={className ? `cdp-th-sort ${className}` : 'cdp-th-sort'} onClick={() => onSort(col)} title="Sort by this column"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {label}{active && <span className="cdp-sortcaret">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}
