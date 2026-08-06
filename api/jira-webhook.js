/* =========================================================================
   /api/jira-webhook — receives Jira webhook events and (STUB) notifies the
   customer contacts based on the engagement's notify_prefs.

   Triggers: a feed transitioning INTO "Customer Feedback - Sample" (feedback
   request) and comment-created. Actual email SENDING is not wired yet — for
   now it records the intended email in notify_log + logs `[notify]`. Swap the
   stub for a provider (Resend/etc.) later. Validated by NOTIFY_WEBHOOK_SECRET.

   SETUP (Jira admin): create a webhook pointing at
   https://<app>/api/jira-webhook?secret=<NOTIFY_WEBHOOK_SECRET> for the DOD
   project, events: "issue updated" + "comment created".
   ========================================================================= */
import { fetchIssue } from './_access.js';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WEBHOOK_SECRET = process.env.NOTIFY_WEBHOOK_SECRET || '';
const FEEDBACK_STATUS = 'Customer Feedback - Sample';
const svc = (SUPABASE_URL && SUPABASE_SERVICE)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { persistSession: false } })
  : null;

const feedbackEmail = (feed) => ({ subject: `Sample ready for review — ${feed}`, text: `The sample for ${feed} is ready for your review in the Zyte Customer Data Portal. Please review and approve when you're happy.` });
const commentEmail = (feed) => ({ subject: `New comment on ${feed}`, text: `There's a new comment on ${feed} in the Zyte Customer Data Portal.` });

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only.' }); return; }
  const secret = (req.query && req.query.secret) || req.headers['x-webhook-secret'] || '';
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) { res.status(401).json({ error: 'Unauthorized.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const event = body && body.webhookEvent;
  const issue = body && body.issue;
  const feedKey = issue && issue.key;

  try {
    let kind = null;
    if (event === 'comment_created') kind = 'comment';
    else if (event === 'jira:issue_updated') {
      const items = (body.changelog && body.changelog.items) || [];
      if (items.some((i) => i.field === 'status' && i.toString === FEEDBACK_STATUS)) kind = 'feedback';
    }
    if (!kind || !feedKey) { res.status(200).json({ ok: true, skipped: 'no matching event' }); return; }

    // Resolve the parent epic (from the payload if present, else fetch it).
    let parentKey = issue.fields && issue.fields.parent && issue.fields.parent.key;
    if (!parentKey) {
      try { const full = await fetchIssue(feedKey, { fields: ['parent'] }); parentKey = full && full.fields && full.fields.parent && full.fields.parent.key; } catch { /* ignore */ }
    }
    if (!parentKey || !svc) { res.status(200).json({ ok: true, skipped: 'no parent / no db' }); return; }

    const { data: pref } = await svc.from('notify_prefs').select('level, recipients').eq('epic_key', parentKey).maybeSingle();
    const level = (pref && pref.level) || 'none';
    const recipients = (pref && pref.recipients) || [];

    const wants = level === 'comments_feedback' ? (kind === 'feedback' || kind === 'comment')
      : level === 'feedback' ? kind === 'feedback'
      : level === 'digest' ? true       // batched — logged now, a daily-digest cron sends later
      : false;
    if (!wants || recipients.length === 0) { res.status(200).json({ ok: true, skipped: `level=${level}` }); return; }

    const tmpl = kind === 'feedback' ? feedbackEmail(feedKey) : commentEmail(feedKey);
    const status = level === 'digest' ? 'digest-queued' : 'stub';
    // STUB: record the intended email; real provider send is a follow-up.
    await svc.from('notify_log').insert({ epic_key: parentKey, feed_key: feedKey, kind, to_emails: recipients, subject: tmpl.subject, status });
    console.log('[notify]', kind, feedKey, '->', recipients.join(','), '|', tmpl.subject, '| status', status, '(send not wired)');
    res.status(200).json({ ok: true, kind, recipients: recipients.length, status });
  } catch (err) {
    console.warn('[notify] error', String((err && err.message) || err));
    res.status(200).json({ ok: false });
  }
}
