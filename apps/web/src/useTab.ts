import { useCallback, useEffect, useState } from 'react';

export const TABS = ['choose', 'watch', 'result', 'details'] as const;
export type Tab = (typeof TABS)[number];

/** The step named in the address (`#result`); anything unknown falls back to the first step. */
export function parseTab(hash: string): Tab {
  const name = hash.replace(/^#/, '');
  return (TABS as readonly string[]).includes(name) ? (name as Tab) : 'choose';
}

/** The open tab, kept in the address so a link opens on the right page and Back goes to the previous tab. */
export function useTab(): [Tab, (tab: Tab) => void] {
  const [tab, setTab] = useState<Tab>(() => parseTab(window.location.hash));
  useEffect(() => {
    const onHash = () => setTab(parseTab(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // Setting the hash keeps the ?run= query and fires hashchange, which updates the state.
  const open = useCallback((next: Tab) => {
    if (parseTab(window.location.hash) === next) return;
    window.location.hash = next;
  }, []);
  return [tab, open];
}
