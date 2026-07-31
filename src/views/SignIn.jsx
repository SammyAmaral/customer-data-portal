import React, { useState } from 'react';
import { Mail, ShieldCheck } from 'lucide-react';
import { signInWithEmail, signInWithGoogle } from '../lib/auth.js';

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.5 29.3 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.5 29.3 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 43.5c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 34.5 26.7 35.5 24 35.5c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39 16.2 43.5 24 43.5z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C41.4 36 43.5 30.6 43.5 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}

export default function SignIn({ configured }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setState('sending'); setError('');
    try {
      await signInWithEmail(email);
      setState('sent');
    } catch (err) {
      setError(err.message || 'Could not send the sign-in link.');
      setState('error');
    }
  }

  async function google() {
    setState('sending'); setError('');
    try {
      await signInWithGoogle(); // redirects away on success
    } catch (err) {
      setError(err.message || 'Google sign-in isn’t available yet.');
      setState('error');
    }
  }

  return (
    <div className="cdp-signin">
      <div className="cdp-signin-card">
        <div className="cdp-brand" style={{ cursor: 'default' }}>
          <span className="cdp-wordmark">zyte</span>
          <span className="cdp-brand-underline" />
        </div>
        <h2>Customer Data Portal</h2>
        <p>Sign in with your email to see the live status of your data delivery engagement.</p>

        {!configured && (
          <div className="cdp-banner warn">
            Sign-in isn’t configured yet. Set <code>VITE_SUPABASE_URL</code> and
            <code> VITE_SUPABASE_ANON_KEY</code> (and the server keys) to enable magic-link login.
          </div>
        )}

        {state === 'sent' ? (
          <div className="cdp-banner ok">
            <strong>Check your inbox.</strong> We’ve emailed a secure sign-in link to <b>{email}</b>.
            Open it on this device to continue.
          </div>
        ) : (
          <>
            {state === 'error' && <div className="cdp-banner err">{error}</div>}
            <button type="button" className="cdp-btn cdp-btn-ghost cdp-btn-google"
              onClick={google} disabled={!configured || state === 'sending'}>
              <GoogleIcon /> Continue with Google
            </button>
            <div className="cdp-or"><span>or with email</span></div>
            <form onSubmit={submit}>
            <div className="cdp-field">
              <label htmlFor="email">Work email</label>
              <input
                id="email" type="email" autoComplete="email" placeholder="you@company.com"
                value={email} onChange={(e) => setEmail(e.target.value)} disabled={!configured || state === 'sending'}
              />
            </div>
            <button className="cdp-btn cdp-btn-primary" style={{ width: '100%', justifyContent: 'center' }}
              disabled={!configured || state === 'sending'}>
              <Mail size={16} /> {state === 'sending' ? 'Sending link…' : 'Email me a sign-in link'}
            </button>
          </form>
          </>
        )}

        <div className="cdp-note">
          <ShieldCheck size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          You’ll only ever see the engagement(s) granted to your email. Access is checked on every request.
        </div>
      </div>
    </div>
  );
}
