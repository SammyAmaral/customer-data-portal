/* =========================================================================
   /api/notify-prefs — per-engagement customer-notification settings (admin).
   GET  ?key=DOD-#### → { level, recipients }
   POST { key, level, recipients[] } → upsert
   Internal-only; stored in notify_prefs (service-role). level ∈
   none | feedback | comments_feedback | digest.
   ========================================================================= */
import { getUserScope } from './_access.js';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const svc = (SUPABASE_URL && SUPABASE_SERVICE)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { persistSession: false } })
  : null;
const LEVELS = ['none', 'feedback', 'comments_feedback', 'digest'];

export default async function handler(req, res) {
  const scope = await getUserScope(req);
  if (!scope.ok) { res.status(scope.status).json({ error: scope.error }); return; }
  if (!scope.internal) { res.status(403).json({ error: 'The notification settings are internal-only.' }); return; }
  if (!svc) { res.status(200).json({ ok: false, level: 'none', recipients: [] }); return; }

  if (req.method === 'GET') {
    const key = String((req.query && req.query.key) || '').toUpperCase().trim();
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) { res.status(400).json({ error: 'A valid epic key is required.' }); return; }
    try {
      const { data } = await svc.from('notify_prefs').select('level, recipients, updated_at').eq('epic_key', key).maybeSingle();
      res.status(200).json({ ok: true, level: (data && data.level) || 'none', recipients: (data && data.recipients) || [], updatedAt: data && data.updated_at });
    } catch (e) { res.status(200).json({ ok: false, level: 'none', recipients: [] }); }
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const key = String((body && body.key) || '').toUpperCase().trim();
    const level = LEVELS.includes(body && body.level) ? body.level : 'none';
    const recipients = Array.isArray(body && body.recipients) ? body.recipients.filter(Boolean) : [];
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) { res.status(400).json({ error: 'A valid epic key is required.' }); return; }
    try {
      await svc.from('notify_prefs').upsert({ epic_key: key, level, recipients, updated_at: new Date().toISOString() }, { onConflict: 'epic_key' });
      res.status(200).json({ ok: true, level, recipients });
    } catch (e) { res.status(500).json({ error: 'Failed to save notification settings.' }); }
    return;
  }

  res.status(405).json({ error: 'GET or POST only.' });
}
