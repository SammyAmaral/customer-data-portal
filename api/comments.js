/* =========================================================================
   /api/comments?feed=DOD-#### — the feed's Jira comments (read-only).

   The panel on the Data Feed Status table reads a Crawling-Component's real
   Jira comments. Access is authorized via the feed's PARENT epic (feed keys
   aren't in the allow-list): internal sees all, external only if the parent
   epic is in their scope. One Jira GET pulls both `parent` + `comment`.
   Writing comments / approvals is deferred (mocked client-side for now).
   ========================================================================= */
import { getUserScope, requireJira, fetchIssue } from './_access.js';
import { personName, adfLines } from './_map.js';

export default async function handler(req, res) {
  const scope = await getUserScope(req);
  if (!scope.ok) { res.status(scope.status).json({ error: scope.error }); return; }
  if (!requireJira(res)) return;

  const feed = String((req.query && req.query.feed) || '').toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(feed)) {
    res.status(400).json({ error: 'A valid feed key is required, e.g. ?feed=DOD-14419.' });
    return;
  }

  try {
    const issue = await fetchIssue(feed, { fields: ['parent', 'comment', 'summary'] });
    if (!issue || !issue.fields) { res.status(404).json({ error: 'Feed not found.' }); return; }

    const parentKey = issue.fields.parent && issue.fields.parent.key;
    if (!scope.internal && !(parentKey && scope.epicKeys && scope.epicKeys.has(parentKey))) {
      res.status(403).json({ error: 'You do not have access to this feed.' });
      return;
    }

    const raw = (issue.fields.comment && issue.fields.comment.comments) || [];
    const comments = raw.slice(-15).map((c) => ({
      id: c.id,
      author: personName(c.author) || 'Zyte',
      when: c.created || c.updated || null,
      lines: adfLines(c.body),
    }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ ok: true, feed, total: raw.length, comments });
  } catch (err) {
    res.status(502).json({ error: 'Failed to read comments from Jira.', detail: String((err && err.message) || err) });
  }
}
