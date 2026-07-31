/* =========================================================================
   auth.js — client-side Supabase auth (email magic-link) + authed fetch.

   The browser only ever holds the anon key + the signed-in user's JWT. Every
   data request carries that JWT so the serverless API can decide, server-side,
   which engagements this person may see. If Supabase env vars aren't set the
   app still loads and shows a clear "auth not configured" sign-in screen.
   ========================================================================= */
import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(URL && ANON);
const supabase = isConfigured ? createClient(URL, ANON) : null;

export async function getSession() {
  if (!isConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export function onAuthChange(cb) {
  if (!isConfigured) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

// Passwordless magic link. Supabase emails a one-time link that returns the
// user to this origin with a session. We keep the redirect on the bare origin
// so it doesn't collide with our own hash route; App restores the intended
// report from localStorage after sign-in.
export async function signInWithEmail(email) {
  if (!isConfigured) throw new Error('Sign-in is not configured yet.');
  // Remember the report the user was opening so we can return to it after the
  // magic-link round-trip (the redirect drops our hash route).
  if (window.location.hash) localStorage.setItem('cdp_return', window.location.hash);
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

// Google OAuth. `hd` nudges Google to the zyte.com workspace (a soft hint —
// the real Zyte-only enforcement is the server-side domain gate). Redirects to
// Google, then back to this origin; App restores the intended report after.
export async function signInWithGoogle() {
  if (!isConfigured) throw new Error('Sign-in is not configured yet.');
  if (window.location.hash) localStorage.setItem('cdp_return', window.location.hash);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { hd: 'zyte.com', prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

export async function signOut() {
  if (!isConfigured) return;
  await supabase.auth.signOut();
}

// Fetch a JSON API route with the current access token attached. Throws an
// Error whose `.status` is the HTTP status (so callers can special-case 403).
export async function fetchWithAuth(path) {
  if (!isConfigured) { const e = new Error('Auth is not configured.'); e.status = 501; throw e; }
  const { data } = await supabase.auth.getSession();
  const token = data.session && data.session.access_token;
  const resp = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let json = {};
  try { json = await resp.json(); } catch { /* non-JSON error body */ }
  if (!resp.ok) {
    const err = new Error(json.error || `Request failed (${resp.status}).`);
    err.status = resp.status;
    err.detail = json.detail;
    throw err;
  }
  return json;
}
