import React, { useState } from 'react';
import { Mail, ShieldCheck } from 'lucide-react';
import { signInWithEmail } from '../lib/auth.js';

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
          <form onSubmit={submit}>
            {state === 'error' && <div className="cdp-banner err">{error}</div>}
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
        )}

        <div className="cdp-note">
          <ShieldCheck size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          You’ll only ever see the engagement(s) granted to your email. Access is checked on every request.
        </div>
      </div>
    </div>
  );
}
