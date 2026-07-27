/* =========================================================================
   /api/portfolio — the list of engagements the signed-in user may see.

   Internal (Zyte) users get every active + recently-delivered DOD engagement.
   External customers get ONLY the Epics granted to their email in the
   report_access allow-list (any age). Authorization is resolved server-side by
   getUserScope(); the client never decides what it's allowed to load.
   ========================================================================= */
import { getUserScope, requireJira, fetchIssues, PROJECT } from './_access.js';
import {
  EPIC_LIST_FIELDS, CHILD_FIELDS, mapEpicListRow, feedBucket, derivePhase,
} from './_map.js';

// Feed counts + phase for a set of Epics, via one batched child query per chunk.
async function childRollups(epicKeys) {
  const rollup = {}; // key -> { feedStatuses:[], kickoffDone:bool }
  for (const k of epicKeys) rollup[k] = { feedStatuses: [], kickoffDone: false };
  const chunkSize = 40;
  for (let i = 0; i < epicKeys.length; i += chunkSize) {
    const chunk = epicKeys.slice(i, i + chunkSize);
    const jql = `parent in (${chunk.join(',')}) AND issuetype in ("Crawling-Component","Task") ORDER BY created ASC`;
    let children = [];
    try {
      children = await fetchIssues({ jql, fields: [...CHILD_FIELDS, 'parent'] });
    } catch { /* best-effort — a rollup failure shouldn't break the portfolio */ }
    for (const c of children) {
      const f = c.fields || {};
      const parentKey = f.parent && f.parent.key;
      if (!parentKey || !rollup[parentKey]) continue;
      const type = f.issuetype ? f.issuetype.name : '';
      const status = f.status ? f.status.name : '';
      if (type === 'Crawling-Component') {
        rollup[parentKey].feedStatuses.push(status);
      } else if (/kickoff|solution design/i.test(f.summary || '') && /done|complete|closed/i.test(status)) {
        rollup[parentKey].kickoffDone = true;
      }
    }
  }
  return rollup;
}

function countsFor(statuses) {
  const c = { total: statuses.length, done: 0, review: 0, qa: 0, progress: 0, blocked: 0, todo: 0, rejected: 0 };
  for (const s of statuses) c[feedBucket(s)]++;
  return c;
}

export default async function handler(req, res) {
  const scope = await getUserScope(req);
  if (!scope.ok) { res.status(scope.status).json({ error: scope.error }); return; }
  if (!requireJira(res)) return;

  // Customers with no grants see an empty (but valid) portfolio.
  if (!scope.internal && scope.epicKeys.size === 0) {
    res.status(200).json({ internal: false, email: scope.email, count: 0, engagements: [] });
    return;
  }

  try {
    const jql = scope.internal
      ? `project = "${PROJECT}" AND issuetype = Epic AND status != "Rejected / Cancelled" ` +
        `AND (statusCategory != Done OR resolutiondate >= -60d) ORDER BY updated DESC`
      : `key in (${[...scope.epicKeys].join(',')}) AND issuetype = Epic ORDER BY updated DESC`;

    const epics = await fetchIssues({ jql, fields: EPIC_LIST_FIELDS });
    const keys = epics.map((e) => e.key);
    const rollup = keys.length ? await childRollups(keys) : {};

    const engagements = epics.map((e) => {
      const r = rollup[e.key] || { feedStatuses: [], kickoffDone: false };
      return mapEpicListRow(e, {
        feedCounts: countsFor(r.feedStatuses),
        phase: derivePhase(r.feedStatuses, r.kickoffDone),
      });
    });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({
      internal: scope.internal,
      email: scope.email,
      count: engagements.length,
      engagements,
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to pull from Jira.', detail: String(err.message || err) });
  }
}
