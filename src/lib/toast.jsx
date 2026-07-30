/* =========================================================================
   toast.jsx — tiny toast notification system (no dependency).

   <ToastProvider> wraps the app and renders a fixed <Toaster>. Anywhere below,
   call const toast = useToast() and toast.success('…') / .error('…') / .info('…').
   Toasts auto-dismiss (~3.2s; errors linger longer) and can be dismissed early.
   ========================================================================= */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

const ICON = {
  success: <CheckCircle2 size={15} />,
  error: <AlertTriangle size={15} />,
  info: <Info size={15} />,
};

const ToastCtx = createContext({ push: () => {}, success: () => {}, error: () => {}, info: () => {}, dismiss: () => {} });
export function useToast() { return useContext(ToastCtx); }

let seq = 0;
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id]; }
  }, []);

  const push = useCallback((message, type = 'info', ms = 3200) => {
    seq += 1;
    const id = seq;
    setToasts((t) => [...t, { id, message, type }]);
    timers.current[id] = setTimeout(() => dismiss(id), ms);
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    push,
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error', 5200),
    info: (m) => push(m, 'info'),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="cdp-toaster" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`cdp-toast ${t.type}`}>
            <span className="ic">{ICON[t.type] || ICON.info}</span>
            <span className="msg">{t.message}</span>
            <button className="x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
