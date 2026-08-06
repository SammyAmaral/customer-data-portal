/* =========================================================================
   ChangeRequest — customer "submit a change request" page (#/change/{KEY}).
   PLACEHOLDER for now: the form UI is real but submitting is a preview — it
   doesn't create anything yet. Wiring it to a Jira Change Order is a follow-up.
   ========================================================================= */
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import { fetchWithAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { useChrome } from '../lib/chrome.jsx';
import { useToast } from '../lib/toast.jsx';
import AccessDenied from './AccessDenied.jsx';

const TYPES = ['Schema change', 'New site / feed', 'Volume change', 'Delivery / frequency', 'Pause / cancel', 'Other'];
const URGENCY = ['Standard', 'High', 'Urgent'];

export default function ChangeRequest({ epicKey, email }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const { setEngagement } = useChrome();
  const toast = useToast();
  const [type, setType] = useState(TYPES[0]);
  const [urgency, setUrgency] = useState('Standard');
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    fetchWithAuth(`/api/epic?key=${encodeURIComponent(epicKey)}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [epicKey]);

  useEffect(() => {
    if (data) setEngagement({ key: data.key, customer: data.customer, internal: !!data.internal });
  }, [data, setEngagement]);

  if (error && error.status === 403) return <AccessDenied message={error.message} />;
  if (error) {
    return <div className="cdp-wrap"><div className="cdp-emptystate" style={{ marginTop: 40 }}>
      <h3>Couldn’t load this engagement</h3><p>{error.message}</p>
    </div></div>;
  }
  if (!data) return <div className="cdp-center"><div className="cdp-spinner" /></div>;

  const submit = (e) => {
    e.preventDefault();
    toast.info('Preview only — change-request submission isn’t wired up yet.');
  };

  return (
    <div className="cdp-wrap">
      <button className="cdp-backlink" onClick={() => navigate(`#/report/${data.key}`)}><ArrowLeft size={16} /> Status report</button>

      <section className="cdp-report-hero">
        <div className="rh-top"><div>
          <div className="cdp-eyebrow" style={{ color: '#9FC0FF' }}>{data.customer}</div>
          <h1>Change order</h1>
          <div className="cust">Request a change to {data.name} · {data.key}</div>
        </div></div>
      </section>

      <div className="cdp-note" style={{ margin: '14px 0 0' }}>
        This is a <b>preview</b> of the change-request form — submitting isn’t connected yet. We’ll wire it to raise a Change Order in Jira next.
      </div>

      <div className="cdp-metacards" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
        <form className="cdp-metacard" onSubmit={submit}>
          <h4>New change request</h4>
          <div className="cdp-crform">
            <label>Type
              <select className="cdp-select" value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label>Urgency
              <select className="cdp-select" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                {URGENCY.map((u) => <option key={u}>{u}</option>)}
              </select>
            </label>
            <label className="wide">Summary
              <input className="cdp-crinput" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Short title for the change" />
            </label>
            <label className="wide">Details
              <textarea className="cdp-crinput" rows={5} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Describe what should change and why…" />
            </label>
          </div>
          <button className="cdp-btn cdp-btn-primary" style={{ marginTop: 14, justifyContent: 'center' }}><Send size={15} /> Submit change request</button>
          <div className="cdp-note" style={{ marginTop: 8 }}>Requested by {email || 'you'}.</div>
        </form>

        <div className="cdp-metacard">
          <h4>Existing change requests</h4>
          {data.changeRequests && data.changeRequests.length > 0
            ? <ul className="cdp-list">{data.changeRequests.map((l, i) => <li key={i}>{l}</li>)}</ul>
            : <div className="cdp-empty">None logged on this engagement.</div>}
        </div>
      </div>
    </div>
  );
}
