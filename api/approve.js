/* =========================================================================
   /api/approve (POST { feed:"DOD-####" }) — the customer approves the sample.

   Records the approval as a Jira COMMENT on the feed (the chosen behaviour —
   the status change stays with the delivery team). Authorized via the feed's
   parent epic, like /api/comments. The signed-in email is recorded in the text.
   ========================================================================= */
import { getUserScope, requireJira, fetchIssue, jiraComment } from './_access.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only.' }); return; }
  const scope = await getUserScope(req);
  if (!scope.ok) { res.status(scope.status).json({ error: scope.error }); return; }
  if (!requireJira(res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const feed = String((body && body.feed) || '').toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(feed)) { res.status(400).json({ error: 'A valid feed key is required.' }); return; }

  try {
    const issue = await fetchIssue(feed, { fields: ['parent'] });
    const parentKey = issue && issue.fields && issue.fields.parent && issue.fields.parent.key;
    if (!scope.internal && !(parentKey && scope.epicKeys && scope.epicKeys.has(parentKey))) {
      res.status(403).json({ error: 'You do not have access to this feed.' });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const text = `Sample approved by ${scope.email} on ${today} via the Customer Data Portal. `
      + 'This authorises Zyte to complete the crawler and move it to production, starting the recurring '
      + 'delivery and subscription for this feed. The status change is left to the delivery team.';
    const comment = await jiraComment(feed, text);
    res.status(200).json({ ok: true, feed, commentId: comment && comment.id });
  } catch (err) {
    res.status(502).json({ error: 'Failed to record the approval in Jira.', detail: String((err && err.message) || err) });
  }
}
