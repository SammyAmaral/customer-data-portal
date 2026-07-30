/* =========================================================================
   chrome.jsx — shared "app chrome" state so the shell can render breadcrumbs
   and the contextual sidebar for whichever engagement a view has loaded.

   A data view calls useChrome().setEngagement({ key, customer, internal })
   after its fetch; the Shell reads it (matched to the current route key) to
   upgrade the breadcrumb from a bare "DOD-####" to the customer name and to
   decide whether the internal-only "Technical view" nav item shows.
   ========================================================================= */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ChromeCtx = createContext({ engagement: null, setEngagement: () => {} });
export function useChrome() { return useContext(ChromeCtx); }

export function ChromeProvider({ children }) {
  const [engagement, setEng] = useState(null);
  const setEngagement = useCallback((e) => setEng(e), []);
  const value = useMemo(() => ({ engagement, setEngagement }), [engagement, setEngagement]);
  return <ChromeCtx.Provider value={value}>{children}</ChromeCtx.Provider>;
}
