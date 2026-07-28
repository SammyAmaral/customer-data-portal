import React, { useEffect, useState, useCallback } from 'react';
import { LogOut } from 'lucide-react';
import { getSession, onAuthChange, signOut, isConfigured } from './lib/auth.js';
import { useHashRoute, navigate } from './lib/router.js';
import SignIn from './views/SignIn.jsx';
import Portfolio from './views/Portfolio.jsx';
import Report from './views/Report.jsx';

export const RETURN_KEY = 'cdp_return';

export default function App() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const route = useHashRoute();

  useEffect(() => {
    let alive = true;
    getSession().then((s) => { if (alive) { setSession(s); setReady(true); } });
    const off = onAuthChange((s) => {
      setSession(s);
      // Restore the report the user was heading to before the magic-link hop.
      if (s) {
        const back = localStorage.getItem(RETURN_KEY);
        if (back) { localStorage.removeItem(RETURN_KEY); if (back !== window.location.hash) window.location.hash = back; }
      }
    });
    return () => { alive = false; off(); };
  }, []);

  const handleSignOut = useCallback(async () => { await signOut(); navigate(''); }, []);

  let body;
  if (!ready) {
    body = <div className="cdp-center"><div className="cdp-spinner" /></div>;
  } else if (!isConfigured || !session) {
    body = <SignIn configured={isConfigured} />;
  } else if (route.name === 'report') {
    body = <Report epicKey={route.key} />;
  } else {
    body = <Portfolio />;
  }

  const email = session && session.user && session.user.email;

  return (
    <div className="cdp-root">
      <style>{CSS}</style>
      {session && (
        <header className="cdp-topbar">
          <button className="cdp-brand" onClick={() => navigate('')} aria-label="Home">
            <span className="cdp-wordmark">zyte</span>
            <span className="cdp-brand-underline" />
            <span className="cdp-brand-app">Customer Data Portal</span>
          </button>
          <div className="cdp-topbar-right">
            {email && <span className="cdp-user" title={email}>{email}</span>}
            <button className="cdp-btn cdp-btn-ghost" onClick={handleSignOut}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </header>
      )}
      {body}
    </div>
  );
}

/* ======================================================================= */
const CSS = `
.cdp-root{
  --ink:#0B1E3B; --navy-deep:#171C50; --navy:#123A6B; --blue:#2F6FED;
  --blue-bright:#5B9BFF; --blue-tint:#EEF3FC; --grad-violet:#6B1B96; --grad-red:#F23039;
  --paper:#FFFFFF; --slate:#5C6B84; --line:#E3E9F5; --wash:#F4F7FD;
  --rag-green:#0E9C78; --rag-amber:#D68A34; --rag-red:#C4432F;
  --maxw:1320px;
  font-family:'Inter',system-ui,sans-serif; color:var(--ink);
  background:var(--wash); min-height:100vh; -webkit-font-smoothing:antialiased;
}
.cdp-root *{box-sizing:border-box;}
.cdp-eyebrow{font-family:'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;font-size:11px;font-weight:500;}
a{color:var(--blue);text-decoration:none;} a:hover{text-decoration:underline;}

/* ---- top bar ---- */
.cdp-topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;
  gap:16px;padding:12px 28px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line);}
.cdp-brand{display:flex;align-items:center;gap:10px;background:none;border:0;cursor:pointer;padding:0;}
.cdp-wordmark{font-family:'Sora',sans-serif;font-weight:800;font-size:20px;letter-spacing:-.02em;color:var(--navy-deep);}
.cdp-brand-underline{width:22px;height:3px;border-radius:2px;background:linear-gradient(90deg,var(--grad-violet),var(--grad-red));}
.cdp-brand-app{font-family:'Sora',sans-serif;font-weight:600;font-size:14px;color:var(--slate);padding-left:6px;border-left:1px solid var(--line);}
.cdp-topbar-right{display:flex;align-items:center;gap:12px;}
.cdp-user{font-size:12.5px;color:var(--slate);max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* ---- buttons ---- */
.cdp-btn{display:inline-flex;align-items:center;gap:7px;font-family:'Inter';font-size:13px;font-weight:600;
  border-radius:9px;padding:8px 14px;cursor:pointer;border:1px solid transparent;transition:.15s;}
.cdp-btn-primary{background:var(--blue);color:#fff;} .cdp-btn-primary:hover{background:#255fd6;}
.cdp-btn-ghost{background:#fff;border-color:var(--line);color:var(--ink);} .cdp-btn-ghost:hover{border-color:var(--blue-bright);color:var(--blue);}
.cdp-btn:disabled{opacity:.55;cursor:not-allowed;}

/* ---- layout ---- */
.cdp-wrap{max-width:var(--maxw);margin:0 auto;padding:0 28px 64px;}
.cdp-center{min-height:70vh;display:flex;align-items:center;justify-content:center;}
.cdp-spinner{width:34px;height:34px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--blue);animation:spin 1s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}

/* ---- hero (navy) ---- */
.cdp-hero{background:linear-gradient(135deg,var(--navy-deep) 0%,var(--navy) 100%);color:#fff;position:relative;overflow:hidden;border-radius:0 0 26px 26px;}
.cdp-hero::after{content:"";position:absolute;right:-90px;top:-120px;width:340px;height:340px;
  background:radial-gradient(circle,rgba(91,155,255,.16) 0%,rgba(91,155,255,0) 70%);border-radius:50%;}
.cdp-hero-inner{max-width:var(--maxw);margin:0 auto;padding:34px 28px 30px;position:relative;z-index:1;}
.cdp-hero h1{font-family:'Sora',sans-serif;font-weight:700;letter-spacing:-.015em;font-size:30px;margin:8px 0 6px;}
.cdp-hero p{color:#B9CDF2;font-size:14.5px;margin:0;max-width:640px;}
.cdp-hero .cdp-eyebrow{color:#9FC0FF;}

/* ---- KPI cards ---- */
.cdp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:24px;}
.cdp-kpi{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:15px 16px;}
.cdp-kpi .n{font-family:'Sora',sans-serif;font-weight:700;font-size:26px;line-height:1;}
.cdp-kpi .l{color:#B9CDF2;font-size:12px;margin-top:7px;}
.cdp-kpi.alert .n{color:#FFB4A6;}

/* ---- filters ---- */
.cdp-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:22px 0 18px;}
.cdp-search{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px 12px;min-width:240px;flex:1;max-width:360px;}
.cdp-search input{border:0;outline:0;font-size:14px;font-family:'Inter';width:100%;color:var(--ink);background:transparent;}
.cdp-chip{font-size:12.5px;font-weight:600;border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 13px;cursor:pointer;color:var(--slate);}
.cdp-chip.active{background:var(--navy-deep);color:#fff;border-color:var(--navy-deep);}
.cdp-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:6px 0 14px;}
.cdp-select{font-size:12.5px;font-weight:600;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:10px;padding:7px 30px 7px 12px;cursor:pointer;font-family:'Inter';outline:none;appearance:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235C6B84' stroke-width='3'><path d='M6 9l6 6 6-6'/></svg>");background-repeat:no-repeat;background-position:right 10px center;}
.cdp-select:focus{border-color:var(--blue);}
.cdp-viewtoggle{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff;}
.cdp-viewtoggle button{border:0;background:none;padding:7px 11px;font-size:12.5px;font-weight:600;color:var(--slate);cursor:pointer;display:inline-flex;align-items:center;gap:6px;}
.cdp-viewtoggle button.active{background:var(--navy-deep);color:#fff;}
.cdp-ptable{width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;}
.cdp-ptable thead th{text-align:left;font-family:'Sora';font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--slate);padding:11px 14px;border-bottom:1px solid var(--line);background:var(--wash);}
.cdp-ptable thead th.num{text-align:center;}
.cdp-ptable tbody td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:middle;}
.cdp-ptable tbody tr:last-child td{border-bottom:0;}
.cdp-ptable tbody tr{cursor:pointer;}
.cdp-ptable tbody tr:hover{background:var(--blue-tint);}
.cdp-ptable .cust{font-family:'Sora';font-weight:700;font-size:13.5px;color:var(--ink);}
.cdp-ptable .eng{font-size:12px;color:var(--slate);}
.cdp-minibar{height:7px;border-radius:4px;background:var(--wash);overflow:hidden;display:flex;min-width:96px;}
.cdp-minibar i{display:block;height:100%;}

/* ---- engagement cards ---- */
.cdp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;}
.cdp-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px;cursor:pointer;transition:.16s;display:flex;flex-direction:column;gap:13px;}
.cdp-card:hover{border-color:var(--blue-bright);box-shadow:0 10px 30px -18px rgba(18,58,107,.5);transform:translateY(-2px);}
.cdp-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
.cdp-card h3{font-family:'Sora',sans-serif;font-weight:700;font-size:16.5px;margin:0;letter-spacing:-.01em;}
.cdp-card .sub{font-size:12.5px;color:var(--slate);margin-top:3px;}
.cdp-rag{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600;white-space:nowrap;}
.cdp-rag .dot{width:11px;height:11px;border-radius:50%;box-shadow:0 0 0 4px rgba(0,0,0,.04);}
.cdp-meta-row{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12.5px;color:var(--slate);}
.cdp-meta-row b{color:var(--ink);font-weight:600;}
.cdp-progress{height:8px;border-radius:5px;background:var(--wash);overflow:hidden;display:flex;}
.cdp-progress i{display:block;height:100%;}
.cdp-phasechip{font-size:11px;font-weight:600;color:var(--navy);background:var(--blue-tint);border-radius:6px;padding:3px 9px;display:inline-block;}

/* ---- report ---- */
.cdp-backlink{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--slate);background:none;border:0;cursor:pointer;padding:16px 0 0;}
.cdp-backlink:hover{color:var(--blue);}
.cdp-report-hero{background:linear-gradient(135deg,var(--navy-deep) 0%,var(--navy) 100%);color:#fff;border-radius:20px;padding:24px 26px;position:relative;overflow:hidden;margin-top:12px;}
.cdp-report-hero::after{content:"";position:absolute;right:-60px;top:-90px;width:260px;height:260px;background:radial-gradient(circle,rgba(91,155,255,.18) 0%,rgba(91,155,255,0) 70%);border-radius:50%;}
.cdp-report-hero .rh-top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;position:relative;z-index:1;flex-wrap:wrap;}
.cdp-report-hero h1{font-family:'Sora',sans-serif;font-weight:700;font-size:26px;letter-spacing:-.015em;margin:6px 0 4px;}
.cdp-report-hero .cust{color:#B9CDF2;font-size:14px;}
.cdp-biglight{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:10px 14px;}
.cdp-biglight .dot{width:16px;height:16px;border-radius:50%;}
.cdp-biglight .t{font-size:11px;color:#B9CDF2;} .cdp-biglight .v{font-family:'Sora';font-weight:700;font-size:14px;}
.cdp-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px;position:relative;z-index:1;}
.cdp-actions .cdp-btn-ghost{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);color:#fff;}
.cdp-actions .cdp-btn-ghost:hover{background:rgba(255,255,255,.18);color:#fff;}

.cdp-metacards{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;}
.cdp-metacard{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px 20px;}
.cdp-metacard h4{font-family:'Sora';font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--navy);margin:0 0 13px;}
.cdp-dl{display:grid;grid-template-columns:auto 1fr;gap:9px 16px;font-size:13.5px;}
.cdp-dl dt{color:var(--slate);} .cdp-dl dd{margin:0;font-weight:600;text-align:right;}
.cdp-person{display:flex;flex-direction:column;gap:2px;} .cdp-person .role{font-size:11px;color:var(--slate);font-weight:500;}

/* ---- phase stepper ---- */
.cdp-stepper{display:flex;margin:18px 0;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;}
.cdp-step{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;position:relative;font-size:12.5px;font-weight:600;color:var(--slate);text-align:center;}
.cdp-step:not(:last-child)::after{content:"";position:absolute;right:-11px;top:50%;transform:translateY(-50%);border-left:11px solid var(--wash);border-top:22px solid transparent;border-bottom:22px solid transparent;z-index:2;}
.cdp-step .num{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--wash);border:1px solid var(--line);font-family:'Sora';}
.cdp-step.done{color:var(--rag-green);} .cdp-step.done .num{background:var(--rag-green);color:#fff;border-color:var(--rag-green);}
.cdp-step.current{color:#fff;background:var(--navy);} .cdp-step.current .num{background:#fff;color:var(--navy);border-color:#fff;}
.cdp-step.current:not(:last-child)::after{border-left-color:var(--navy);}

/* ---- report body ---- */
.cdp-report-body{display:grid;grid-template-columns:1.55fr 1fr;gap:16px;margin-top:4px;}
.cdp-report-narrative{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;}
.cdp-feedpanel{margin-top:4px;}
.cdp-band{display:inline-block;font-size:11px;font-weight:700;color:var(--navy);background:var(--blue-tint);border-radius:6px;padding:2px 8px;white-space:nowrap;}
.cdp-panel{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px 20px;}
.cdp-panel h4{font-family:'Sora';font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--navy);margin:0 0 12px;display:flex;align-items:center;gap:8px;}
.cdp-panel + .cdp-panel{margin-top:16px;}
.cdp-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;font-size:13.5px;line-height:1.5;}
.cdp-list li{padding-left:16px;position:relative;color:#33415A;}
.cdp-list li::before{content:"";position:absolute;left:0;top:8px;width:6px;height:6px;border-radius:50%;background:var(--blue-bright);}
.cdp-updates li::before{background:var(--grad-violet);}
.cdp-empty{color:var(--slate);font-size:13px;font-style:italic;}

/* ---- feed table ---- */
.cdp-table{width:100%;border-collapse:collapse;font-size:13px;}
.cdp-table thead th{background:var(--navy-deep);color:#fff;font-family:'Sora';font-weight:600;font-size:12px;text-align:left;padding:10px 12px;}
.cdp-table thead th:first-child{border-radius:10px 0 0 0;} .cdp-table thead th:last-child{border-radius:0 10px 0 0;text-align:center;}
.cdp-table tbody td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle;}
.cdp-table tbody tr:hover{background:var(--wash);}
.cdp-table td.center{text-align:center;} .cdp-feedname{font-weight:600;color:var(--ink);}
.cdp-statuschip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;border-radius:999px;padding:3px 10px;}
.cdp-statuschip .dot{width:8px;height:8px;border-radius:50%;}

/* ---- states / signin ---- */
.cdp-signin{min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,var(--navy-deep) 0%,var(--navy) 60%,#0d2748 100%);}
.cdp-signin-card{background:#fff;border-radius:22px;padding:40px 38px;width:min(430px,92vw);box-shadow:0 40px 90px -40px rgba(0,0,0,.6);}
.cdp-signin-card .cdp-wordmark{font-size:30px;} .cdp-signin-card .cdp-brand-underline{width:34px;height:4px;}
.cdp-signin-card h2{font-family:'Sora';font-weight:700;font-size:21px;margin:20px 0 6px;}
.cdp-signin-card p{color:var(--slate);font-size:14px;margin:0 0 22px;line-height:1.5;}
.cdp-field{display:flex;flex-direction:column;gap:7px;margin-bottom:16px;}
.cdp-field label{font-size:12.5px;font-weight:600;color:var(--slate);}
.cdp-field input{border:1px solid var(--line);border-radius:11px;padding:12px 14px;font-size:15px;font-family:'Inter';outline:0;}
.cdp-field input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(47,111,237,.14);}
.cdp-note{font-size:12.5px;color:var(--slate);margin-top:16px;line-height:1.5;}
.cdp-banner{border-radius:11px;padding:11px 14px;font-size:13px;margin-bottom:16px;}
.cdp-banner.warn{background:#FFF6E9;border:1px solid #F3D9A6;color:#7A531A;}
.cdp-banner.err{background:#FDECEA;border:1px solid #F3C0BA;color:#8A2B1E;}
.cdp-banner.ok{background:#E9F7F1;border:1px solid #A8E0CC;color:#0B6B4F;}

.cdp-emptystate{background:#fff;border:1px dashed var(--line);border-radius:18px;padding:48px;text-align:center;color:var(--slate);}
.cdp-emptystate h3{font-family:'Sora';color:var(--ink);margin:0 0 8px;}

@media(max-width:860px){
  .cdp-metacards,.cdp-report-body,.cdp-report-narrative{grid-template-columns:1fr;}
  .cdp-stepper{flex-wrap:wrap;}
}

/* ---- print (customer PDF export) ---- */
@media print{
  .cdp-root{background:#fff;}
  .cdp-topbar,.cdp-actions,.cdp-backlink{display:none !important;}
  .cdp-report-hero{background:var(--navy-deep) !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .cdp-card,.cdp-metacard,.cdp-panel,.cdp-stepper,.cdp-table thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .cdp-report-narrative{grid-template-columns:1fr 1fr;}
  .cdp-panel,.cdp-metacard{break-inside:avoid;}
}
`;
