import React from 'react';
import { Lock, ArrowLeft } from 'lucide-react';
import { navigate } from '../lib/router.js';

export default function AccessDenied({ message }) {
  return (
    <div className="cdp-wrap">
      <div className="cdp-emptystate" style={{ marginTop: 40 }}>
        <Lock size={30} style={{ color: 'var(--slate)', marginBottom: 12 }} />
        <h3>You don’t have access to this report</h3>
        <p style={{ maxWidth: 460, margin: '0 auto 20px' }}>
          {message || 'This engagement isn’t shared with your account. If you believe this is a mistake, ask your Zyte contact to grant your email access.'}
        </p>
        <button className="cdp-btn cdp-btn-ghost" onClick={() => navigate('')}>
          <ArrowLeft size={15} /> Back to my portfolio
        </button>
      </div>
    </div>
  );
}
