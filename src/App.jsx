import React, { useEffect, useState, useCallback } from 'react';
import { LogOut, LayoutGrid, FileText, Wrench, Menu, ChevronRight } from 'lucide-react';
import { getSession, onAuthChange, signOut, isConfigured } from './lib/auth.js';
import { useHashRoute, navigate } from './lib/router.js';
import { ToastProvider } from './lib/toast.jsx';
import { ChromeProvider, useChrome } from './lib/chrome.jsx';
import SignIn from './views/SignIn.jsx';
import Portfolio from './views/Portfolio.jsx';
import Report from './views/Report.jsx';
import TechView from './views/TechView.jsx';
import SchemaView from './views/SchemaView.jsx';

export const RETURN_KEY = 'cdp_return';
const APP_NAME = 'Customer Data Portal';

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
  const email = session && session.user && session.user.email;

  return (
    <div className="cdp-root">
      <style>{CSS}</style>
      <ToastProvider>
        <ChromeProvider>
          <Shell ready={ready} session={session} route={route} email={email} onSignOut={handleSignOut} />
        </ChromeProvider>
      </ToastProvider>
    </div>
  );
}

function cls(base, on, name = 'open') { return on ? `${base} ${name}` : base; }

function Shell({ ready, session, route, email, onSignOut }) {
  const { engagement } = useChrome();
  const [navOpen, setNavOpen] = useState(false);

  const signedIn = isConfigured && session;
  const engOpen = route.name === 'report' || route.name === 'tech' || route.name === 'tech-schema';
  const eng = engagement && engagement.key === route.key ? engagement : null;
  const engLabel = eng ? eng.customer : route.key;

  // Close the mobile drawer on navigation; Esc also closes it.
  useEffect(() => { setNavOpen(false); }, [route.name, route.key]);
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  // Per-route document title.
  useEffect(() => {
    let t = `Portfolio · ${APP_NAME}`;
    if (!signedIn) t = `Sign in · ${APP_NAME}`;
    else if (route.name === 'report') t = `${engLabel} · Status · ${APP_NAME}`;
    else if (route.name === 'tech') t = `${engLabel} · Technical · ${APP_NAME}`;
    else if (route.name === 'tech-schema') t = `${engLabel} · Schema · ${APP_NAME}`;
    document.title = t;
  }, [signedIn, route.name, engLabel]);

  if (!ready) return <div className="cdp-center"><div className="cdp-spinner" /></div>;
  if (!signedIn) return <SignIn configured={isConfigured} />;

  let body;
  if (route.name === 'report') body = <Report epicKey={route.key} />;
  else if (route.name === 'tech') body = <TechView epicKey={route.key} />;
  else if (route.name === 'tech-schema') body = <SchemaView epicKey={route.key} feedKey={route.feed} />;
  else body = <Portfolio />;

  const initial = (email || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="cdp-shell">
      <button className="cdp-skip" onClick={() => { const m = document.getElementById('cdp-main'); if (m) { m.focus(); m.scrollIntoView(); } }}>
        Skip to content
      </button>
      {navOpen && <div className="cdp-backdrop show" onClick={() => setNavOpen(false)} />}

      <aside className={cls('cdp-sidebar', navOpen)}>
        <button className="cdp-sb-brand" onClick={() => navigate('')} aria-label="Home">
          <span className="cdp-wordmark">zyte</span>
          <span className="cdp-brand-underline" />
          <span className="cdp-brand-app">{APP_NAME}</span>
        </button>

        <nav className="cdp-nav" aria-label="Primary">
          <NavItem icon={<LayoutGrid size={17} />} label="Portfolio" active={route.name === 'portfolio'} onClick={() => navigate('')} />
          {engOpen && (
            <div className="cdp-navgroup">
              <div className="gt" title={engLabel}>{engLabel}</div>
              <NavItem icon={<FileText size={17} />} label="Status report" active={route.name === 'report'} onClick={() => navigate(`#/report/${route.key}`)} />
              {eng && eng.internal && (
                <NavItem icon={<Wrench size={17} />} label="Technical view" active={route.name === 'tech' || route.name === 'tech-schema'} onClick={() => navigate(`#/tech/${route.key}`)} />
              )}
            </div>
          )}
        </nav>

        <div className="cdp-sb-foot">
          <div className="cdp-sb-user">
            <span className="cdp-avatar">{initial}</span>
            {email && <span className="cdp-user" title={email}>{email}</span>}
          </div>
          <button className="cdp-btn cdp-btn-ghost" onClick={onSignOut} style={{ justifyContent: 'center' }}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      <div className="cdp-main">
        <header className="cdp-appbar">
          <button className="cdp-hamburger cdp-btn cdp-btn-ghost" onClick={() => setNavOpen((v) => !v)} aria-label="Toggle menu" aria-expanded={navOpen}>
            <Menu size={16} />
          </button>
          <nav className="cdp-crumbs" aria-label="Breadcrumb">
            <button onClick={() => navigate('')}>Portfolio</button>
            {engOpen && (
              <>
                <ChevronRight size={14} className="sep" />
                {route.name === 'report'
                  ? <span className="cur" title={engLabel}>{engLabel}</span>
                  : <button onClick={() => navigate(`#/report/${route.key}`)}>{engLabel}</button>}
              </>
            )}
            {route.name === 'tech' && (
              <><ChevronRight size={14} className="sep" /><span className="cur">Technical</span></>
            )}
            {route.name === 'tech-schema' && (
              <>
                <ChevronRight size={14} className="sep" />
                <button onClick={() => navigate(`#/tech/${route.key}`)}>Technical</button>
                <ChevronRight size={14} className="sep" />
                <span className="cur">Coverage</span>
              </>
            )}
          </nav>
        </header>

        <main id="cdp-main" tabIndex={-1} className="cdp-viewport" key={`${route.name}:${route.key || ''}`}>
          {body}
        </main>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }) {
  return (
    <button className={cls('cdp-navitem', active, 'active')} onClick={onClick} aria-current={active ? 'page' : undefined}>
      {icon}<span>{label}</span>
    </button>
  );
}

/* ======================================================================= */
const CSS = `
.cdp-root{
  --ink:#0B1E3B; --navy-deep:#171C50; --navy:#123A6B; --blue:#2F6FED;
  --blue-bright:#5B9BFF; --blue-tint:#EEF3FC; --grad-violet:#6B1B96; --grad-red:#F23039;
  --paper:#FFFFFF; --slate:#5C6B84; --line:#E3E9F5; --wash:#F4F7FD;
  --rag-green:#0E9C78; --rag-amber:#D68A34; --rag-red:#C4432F; --amber:#D68A34;
  --maxw:1320px; --sbw:250px;
  --r-sm:8px; --r-md:12px; --r-lg:16px; --r-xl:22px;
  --sh-1:0 1px 2px rgba(18,58,107,.06); --sh-2:0 10px 30px -18px rgba(18,58,107,.5); --sh-3:0 30px 80px -30px rgba(0,0,0,.45);
  font-family:'Inter',system-ui,sans-serif; color:var(--ink);
  background:var(--wash); min-height:100vh; -webkit-font-smoothing:antialiased;
}
.cdp-root *{box-sizing:border-box;}
.cdp-eyebrow{font-family:'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;font-size:11px;font-weight:500;}
a{color:var(--blue);text-decoration:none;} a:hover{text-decoration:underline;}
.cdp-root :focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:6px;}
.cdp-skip{position:absolute;left:-9999px;top:8px;z-index:100;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 13px;font:inherit;font-weight:600;cursor:pointer;}
.cdp-skip:focus{left:12px;}

/* ---- brand bits (shared: sidebar + sign-in) ---- */
.cdp-brand{display:flex;align-items:center;gap:10px;background:none;border:0;cursor:pointer;padding:0;}
.cdp-wordmark{font-family:'Sora',sans-serif;font-weight:800;font-size:20px;letter-spacing:-.02em;color:var(--navy-deep);}
.cdp-brand-underline{width:22px;height:3px;border-radius:2px;background:linear-gradient(90deg,var(--grad-violet),var(--grad-red));}
.cdp-brand-app{font-family:'Sora',sans-serif;font-weight:600;font-size:13px;color:var(--slate);}
.cdp-user{font-size:12px;color:var(--slate);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* ---- app shell (sidebar + appbar) ---- */
.cdp-shell{display:flex;min-height:100vh;align-items:stretch;}
.cdp-sidebar{position:sticky;top:0;height:100vh;width:var(--sbw);flex:0 0 var(--sbw);z-index:30;
  display:flex;flex-direction:column;gap:4px;padding:18px 14px;background:#fff;border-right:1px solid var(--line);}
.cdp-sb-brand{display:flex;align-items:center;gap:9px;flex-wrap:wrap;background:none;border:0;cursor:pointer;padding:4px 8px 16px;text-align:left;}
.cdp-sb-brand .cdp-brand-app{width:100%;padding-top:2px;}
.cdp-nav{display:flex;flex-direction:column;gap:3px;overflow-y:auto;}
.cdp-navitem{display:flex;align-items:center;gap:11px;width:100%;padding:9px 11px;border:0;border-radius:10px;background:none;
  font:inherit;font-size:13.5px;font-weight:600;color:var(--slate);cursor:pointer;text-align:left;transition:.13s;}
.cdp-navitem:hover{background:var(--wash);color:var(--ink);}
.cdp-navitem.active{background:var(--blue-tint);color:var(--navy);}
.cdp-navitem svg{flex:0 0 auto;opacity:.9;}
.cdp-navgroup{margin-top:14px;display:flex;flex-direction:column;gap:3px;}
.cdp-navgroup .gt{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--slate);
  padding:0 11px;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cdp-sb-foot{margin-top:auto;border-top:1px solid var(--line);padding-top:12px;display:flex;flex-direction:column;gap:9px;}
.cdp-sb-user{display:flex;align-items:center;gap:9px;padding:0 6px;}
.cdp-avatar{width:28px;height:28px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;color:#fff;
  font-family:'Sora',sans-serif;font-weight:700;font-size:12px;background:linear-gradient(135deg,var(--blue),var(--grad-violet));}
.cdp-main{flex:1;min-width:0;display:flex;flex-direction:column;}
.cdp-appbar{position:sticky;top:0;z-index:15;display:flex;align-items:center;gap:12px;min-height:52px;padding:10px 22px;
  background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);}
.cdp-hamburger{display:none;padding:7px 9px;}
.cdp-crumbs{display:flex;align-items:center;gap:7px;font-size:13px;min-width:0;}
.cdp-crumbs button{background:none;border:0;cursor:pointer;color:var(--slate);font:inherit;font-weight:600;padding:0;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cdp-crumbs button:hover{color:var(--blue);}
.cdp-crumbs .sep{color:#C6D2E8;flex:0 0 auto;}
.cdp-crumbs .cur{color:var(--ink);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cdp-viewport{flex:1;animation:cdpFade .28s ease both;}
.cdp-backdrop{position:fixed;inset:0;background:rgba(11,30,59,.42);z-index:25;}
@keyframes cdpFade{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}

/* ---- buttons ---- */
.cdp-btn{display:inline-flex;align-items:center;gap:7px;font-family:'Inter';font-size:13px;font-weight:600;
  border-radius:9px;padding:8px 14px;cursor:pointer;border:1px solid transparent;transition:.15s;}
.cdp-btn-primary{background:var(--blue);color:#fff;} .cdp-btn-primary:hover{background:#255fd6;}
.cdp-btn-ghost{background:#fff;border-color:var(--line);color:var(--ink);} .cdp-btn-ghost:hover{border-color:var(--blue-bright);color:var(--blue);}
.cdp-btn:disabled{opacity:.55;cursor:not-allowed;}

/* ---- layout ---- */
.cdp-wrap{max-width:var(--maxw);margin:0 auto;padding:0 28px 64px;}
.cdp-center{min-height:70vh;display:flex;align-items:center;justify-content:center;width:100%;}
.cdp-spinner{width:34px;height:34px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--blue);animation:spin 1s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}

/* ---- hero (navy) ---- */
.cdp-hero{background:linear-gradient(135deg,var(--navy-deep) 0%,var(--navy) 100%);color:#fff;position:relative;overflow:hidden;border-radius:0 0 26px 26px;}
.cdp-hero::after{content:"";position:absolute;right:-90px;top:-120px;width:340px;height:340px;
  background:radial-gradient(circle,rgba(91,155,255,.16) 0%,rgba(91,155,255,0) 70%);border-radius:50%;}
.cdp-hero-inner{max-width:var(--maxw);margin:0 auto;padding:34px 28px 30px;position:relative;z-index:1;}
.cdp-hero h1{font-family:'Sora',sans-serif;font-weight:700;letter-spacing:-.015em;font-size:clamp(23px,4vw,30px);margin:8px 0 6px;}
.cdp-hero p{color:#B9CDF2;font-size:14.5px;margin:0;max-width:640px;}
.cdp-hero .cdp-eyebrow{color:#9FC0FF;}

/* ---- KPI cards ---- */
.cdp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:24px;}
.cdp-kpi{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:15px 16px;color:#fff;text-align:left;font-family:'Inter',sans-serif;display:block;}
.cdp-kpi .n{font-family:'Sora',sans-serif;font-weight:700;font-size:26px;line-height:1;}
.cdp-kpi .l{color:#B9CDF2;font-size:12px;margin-top:7px;}
.cdp-kpi.alert .n{color:#FFB4A6;}
button.cdp-kpi{cursor:pointer;transition:.14s;}
button.cdp-kpi:hover{background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.3);}
.cdp-kpi.active{background:rgba(255,255,255,.2);border-color:#9FC0FF;}
.cdp-kpibar{height:5px;border-radius:3px;background:rgba(255,255,255,.16);margin-top:9px;overflow:hidden;}
.cdp-kpibar i{display:block;height:100%;background:#5DCAA5;}
.cdp-kpiclear{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--blue);background:var(--blue-tint);border:0;border-radius:999px;padding:5px 11px;cursor:pointer;}

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
.cdp-ptable tbody tr:focus-visible{background:var(--blue-tint);outline:2px solid var(--blue);outline-offset:-2px;}
.cdp-ptable .cust{font-family:'Sora';font-weight:700;font-size:13.5px;color:var(--ink);}
.cdp-ptable .eng{font-size:12px;color:var(--slate);}
.cdp-minibar{height:7px;border-radius:4px;background:var(--wash);overflow:hidden;display:flex;min-width:96px;}
.cdp-minibar i{display:block;height:100%;}

/* ---- engagement cards ---- */
.cdp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;}
.cdp-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px;cursor:pointer;transition:.16s;display:flex;flex-direction:column;gap:13px;}
.cdp-card:hover{border-color:var(--blue-bright);box-shadow:var(--sh-2);transform:translateY(-2px);}
.cdp-card:focus-visible{border-color:var(--blue);box-shadow:var(--sh-2);transform:translateY(-2px);}
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
.cdp-phasechip.muted{color:var(--slate);background:var(--wash);}

/* ---- report ---- */
.cdp-backlink{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--slate);background:none;border:0;cursor:pointer;padding:16px 0 0;}
.cdp-backlink:hover{color:var(--blue);}
.cdp-report-hero{background:linear-gradient(135deg,var(--navy-deep) 0%,var(--navy) 100%);color:#fff;border-radius:20px;padding:24px 26px;position:relative;overflow:hidden;margin-top:12px;}
.cdp-report-hero::after{content:"";position:absolute;right:-60px;top:-90px;width:260px;height:260px;background:radial-gradient(circle,rgba(91,155,255,.18) 0%,rgba(91,155,255,0) 70%);border-radius:50%;}
.cdp-report-hero .rh-top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;position:relative;z-index:1;flex-wrap:wrap;}
.cdp-report-hero h1{font-family:'Sora',sans-serif;font-weight:700;font-size:clamp(21px,3.4vw,26px);letter-spacing:-.015em;margin:6px 0 4px;}
.cdp-report-hero .cust{color:#B9CDF2;font-size:14px;}
.cdp-biglight{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:10px 14px;}
.cdp-biglight .dot{width:16px;height:16px;border-radius:50%;}
.cdp-biglight .t{font-size:11px;color:#B9CDF2;} .cdp-biglight .v{font-family:'Sora';font-weight:700;font-size:14px;}
.cdp-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px;position:relative;z-index:1;}
.cdp-actions .cdp-btn-ghost{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);color:#fff;}
.cdp-actions .cdp-btn-ghost:hover{background:rgba(255,255,255,.18);color:#fff;}

.cdp-metacards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:16px;}
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
.cdp-feedpanel{margin-top:16px;}
.cdp-band{display:inline-block;font-size:11px;font-weight:700;color:var(--navy);background:var(--blue-tint);border-radius:6px;padding:2px 8px;white-space:nowrap;}
.cdp-src{font-size:9px;font-weight:700;letter-spacing:.03em;color:var(--grad-violet);background:rgba(107,27,150,.1);border-radius:4px;padding:1px 4px;margin-left:5px;vertical-align:middle;}
.cdp-jobdot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-left:7px;vertical-align:middle;box-shadow:0 0 0 3px rgba(0,0,0,.03);}
/* ---- technical view ---- */
.cdp-techgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:16px;margin-top:16px;}
.cdp-techcard{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 18px;}
.cdp-techcard h3{font-family:'Sora',sans-serif;font-weight:700;font-size:15px;margin:0 0 3px;display:flex;align-items:center;gap:2px;}
.cdp-techcard .sub{font-size:12px;color:var(--slate);margin:2px 0 13px;}
.cdp-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;}
.cdp-metric{background:var(--wash);border-radius:10px;padding:9px 10px;min-width:0;}
.cdp-metric .m-n{font-family:'Sora',sans-serif;font-weight:700;font-size:15px;line-height:1.15;overflow:hidden;text-overflow:ellipsis;}
.cdp-metric .m-l{font-size:10px;color:var(--slate);margin-top:4px;text-transform:uppercase;letter-spacing:.03em;}
.cdp-cfg{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:12.5px;margin:0;}
.cdp-cfg dt{color:var(--slate);white-space:nowrap;} .cdp-cfg dd{margin:0;font-weight:600;text-align:right;}
.cdp-tag{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--navy);background:var(--blue-tint);border-radius:5px;padding:1px 6px;margin-left:6px;vertical-align:middle;}
.cdp-alerts{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;}
.cdp-alert{font-size:11px;font-weight:700;border-radius:6px;padding:2px 8px;white-space:nowrap;}
.cdp-alert.high{color:#fff;background:var(--rag-red);}
.cdp-alert.warn{color:#7A531A;background:#FFF1D6;border:1px solid #F3D9A6;}
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

/* ---- skeletons ---- */
.cdp-sk{display:inline-block;position:relative;overflow:hidden;background:var(--line);border-radius:8px;vertical-align:middle;}
.cdp-sk::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.65),transparent);animation:cdpShimmer 1.3s infinite;}
.cdp-sk.on-dark{background:rgba(255,255,255,.14);}
.cdp-sk.on-dark::after{background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent);}
@keyframes cdpShimmer{100%{transform:translateX(100%);}}

/* ---- toasts ---- */
.cdp-toaster{position:fixed;right:20px;bottom:20px;z-index:60;display:flex;flex-direction:column;gap:10px;max-width:calc(100vw - 40px);}
.cdp-toast{display:flex;align-items:center;gap:10px;min-width:230px;background:var(--ink);color:#fff;border-radius:12px;padding:11px 12px 11px 14px;font-size:13px;font-weight:500;box-shadow:0 18px 40px -18px rgba(0,0,0,.6);animation:cdpToastIn .22s ease both;}
.cdp-toast .ic{display:flex;flex:0 0 auto;}
.cdp-toast.success .ic{color:#5DCAA5;}
.cdp-toast.error{background:#7A1E12;} .cdp-toast.error .ic{color:#FFB4A6;}
.cdp-toast.info .ic{color:var(--blue-bright);}
.cdp-toast .msg{flex:1;}
.cdp-toast .x{background:none;border:0;color:rgba(255,255,255,.6);cursor:pointer;display:flex;padding:2px;border-radius:6px;}
.cdp-toast .x:hover{color:#fff;background:rgba(255,255,255,.12);}
@keyframes cdpToastIn{from{opacity:0;transform:translateY(10px) scale(.98);}to{opacity:1;transform:none;}}

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
.cdp-btn-google{width:100%;justify-content:center;font-size:14px;padding:11px 14px;gap:10px;}
.cdp-or{display:flex;align-items:center;gap:12px;color:var(--slate);font-size:12px;margin:16px 0;}
.cdp-or::before,.cdp-or::after{content:"";flex:1;height:1px;background:var(--line);}
.cdp-note{font-size:12.5px;color:var(--slate);margin-top:16px;line-height:1.5;}
.cdp-banner{border-radius:11px;padding:11px 14px;font-size:13px;margin-bottom:16px;}
.cdp-banner.warn{background:#FFF6E9;border:1px solid #F3D9A6;color:#7A531A;}
.cdp-banner.err{background:#FDECEA;border:1px solid #F3C0BA;color:#8A2B1E;}
.cdp-banner.ok{background:#E9F7F1;border:1px solid #A8E0CC;color:#0B6B4F;}

.cdp-emptystate{background:#fff;border:1px dashed var(--line);border-radius:18px;padding:48px;text-align:center;color:var(--slate);}
.cdp-emptystate h3{font-family:'Sora';color:var(--ink);margin:0 0 8px;}

/* ---- indicators: status row, insights, charts ---- */
.cdp-chip-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
.cdp-insights{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0 6px;}
.cdp-insight-wide{grid-column:1 / -1;}
.cdp-insight-note{font-family:'Inter',sans-serif;font-weight:500;font-size:11px;text-transform:none;letter-spacing:0;color:var(--slate);}
.cdp-columns{display:flex;align-items:stretch;gap:12px;padding-top:6px;}
.cdp-col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:5px;}
.cdp-col.clickable{cursor:pointer;}
.cdp-col-val{font-family:'Sora',sans-serif;font-weight:700;font-size:12.5px;}
.cdp-col-track{flex:1;width:100%;max-width:54px;display:flex;align-items:flex-end;}
.cdp-col-fill{width:100%;border-radius:6px 6px 0 0;min-height:4px;transition:.15s;}
.cdp-col.clickable:hover .cdp-col-fill{filter:brightness(1.07);}
.cdp-col-label{font-size:11px;color:var(--slate);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
/* ---- finishing timeline ---- */
.cdp-timeline{position:relative;overflow-x:auto;padding:4px 2px 2px;}
.cdp-tl-track{position:absolute;left:26px;right:26px;top:36px;height:2px;background:var(--line);border-radius:2px;}
.cdp-tl-stops{display:flex;gap:10px;align-items:flex-start;min-width:100%;position:relative;}
.cdp-tl-stop{flex:1;min-width:66px;display:flex;flex-direction:column;align-items:center;gap:7px;text-align:center;background:none;border:0;font:inherit;padding:0;}
.cdp-tl-stop.clickable{cursor:pointer;}
.cdp-tl-nodewrap{height:64px;display:flex;align-items:center;justify-content:center;}
.cdp-tl-node{border-radius:50%;display:grid;place-items:center;color:#fff;font-family:'Sora',sans-serif;font-weight:700;font-size:13px;box-shadow:0 0 0 4px #fff;transition:.15s;}
.cdp-tl-stop.clickable:hover .cdp-tl-node{transform:scale(1.07);}
.cdp-tl-label{font-size:11.5px;font-weight:700;color:var(--ink);white-space:nowrap;}
.cdp-tl-names{display:flex;flex-direction:column;gap:3px;align-items:center;}
.cdp-tl-chip{font-size:10.5px;color:var(--slate);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cdp-tl-more{font-size:10px;color:var(--blue);font-weight:700;}
.cdp-chart-row{display:flex;align-items:center;gap:24px;flex-wrap:wrap;}
.cdp-chart-center-n{font-family:'Sora',sans-serif;font-weight:700;font-size:18px;fill:var(--ink);}
.cdp-chart-center-l{font-size:10px;fill:var(--slate);text-transform:uppercase;letter-spacing:.06em;}
.cdp-legend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px;min-width:160px;}
.cdp-legend-item{display:flex;align-items:center;gap:9px;width:100%;background:none;border:0;padding:4px 6px;border-radius:8px;font:inherit;font-size:13px;color:var(--ink);text-align:left;}
.cdp-legend-item.clickable{cursor:pointer;} .cdp-legend-item.clickable:hover{background:var(--wash);}
.cdp-legend-item:disabled{cursor:default;}
.cdp-legend-item .sw{width:11px;height:11px;border-radius:3px;flex:0 0 auto;}
.cdp-legend-item .lb{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cdp-legend-item .vl{font-family:'Sora',sans-serif;font-weight:700;}
.cdp-barchart{display:flex;flex-direction:column;gap:7px;}
.cdp-bar-row{display:grid;grid-template-columns:180px 1fr 84px;align-items:center;gap:12px;padding:2px 4px;border-radius:8px;}
.cdp-bar-row.clickable{cursor:pointer;} .cdp-bar-row.clickable:hover{background:var(--wash);}
.cdp-bar-label{font-size:12.5px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cdp-bar-track{height:14px;background:var(--wash);border-radius:7px;overflow:hidden;}
.cdp-bar-fill{display:block;height:100%;background:var(--blue);border-radius:7px;min-width:4px;}
.cdp-bar-val{font-family:'Sora',sans-serif;font-weight:700;font-size:12.5px;text-align:right;color:var(--ink);}

/* ---- schema field coverage ---- */
.cdp-coverage{display:flex;flex-direction:column;gap:7px;}
.cdp-cov-row{display:grid;grid-template-columns:1fr 2fr 46px 72px;align-items:center;gap:12px;}
.cdp-cov-name{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cdp-cov-track{height:12px;background:var(--wash);border-radius:6px;overflow:hidden;}
.cdp-cov-fill{display:block;height:100%;border-radius:6px;min-width:3px;}
.cdp-cov-pct{font-family:'Sora',sans-serif;font-weight:700;font-size:12.5px;text-align:right;}
.cdp-cov-count{font-size:12px;color:var(--slate);text-align:right;}

/* ---- stepper polish ---- */
.cdp-stepper{box-shadow:var(--sh-1);}
.cdp-step .num{font-weight:700;}
.cdp-step.done:not(:last-child)::after{border-left-color:#DCEFE8;}

/* ---- responsive ---- */
@media(max-width:960px){
  .cdp-sidebar{position:fixed;left:0;top:0;transform:translateX(-100%);transition:transform .22s ease;box-shadow:var(--sh-3);}
  .cdp-sidebar.open{transform:none;}
  .cdp-hamburger{display:inline-flex;}
}
@media(min-width:961px){ .cdp-backdrop{display:none;} }
@media(max-width:860px){
  .cdp-metacards,.cdp-report-body,.cdp-report-narrative,.cdp-insights{grid-template-columns:1fr;}
  .cdp-stepper{flex-wrap:wrap;}
}
@media(max-width:600px){
  .cdp-wrap{padding:0 16px 48px;}
  .cdp-hero-inner{padding:26px 16px 24px;}
  .cdp-appbar{padding:10px 14px;}
  .cdp-report-hero{padding:20px 18px;}
  .cdp-kpis{gap:10px;}
  .cdp-bar-row{grid-template-columns:110px 1fr 62px;gap:8px;}
  .cdp-cov-row{grid-template-columns:1fr 1.4fr 40px;gap:8px;}
  .cdp-cov-count{display:none;}
  .cdp-chart-row{gap:14px;}
}
@media(prefers-reduced-motion:reduce){
  .cdp-viewport,.cdp-toast{animation:none;}
  .cdp-sk::after{animation:none;}
  .cdp-card:hover{transform:none;}
}

/* ---- print (customer PDF export) ---- */
@media print{
  .cdp-root{background:#fff;}
  .cdp-sidebar,.cdp-appbar,.cdp-actions,.cdp-backlink,.cdp-toaster,.cdp-skip{display:none !important;}
  .cdp-main{display:block;}
  .cdp-report-hero{background:var(--navy-deep) !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .cdp-card,.cdp-metacard,.cdp-panel,.cdp-stepper,.cdp-table thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .cdp-report-narrative{grid-template-columns:1fr 1fr;}
  .cdp-panel,.cdp-metacard{break-inside:avoid;}
}
`;
