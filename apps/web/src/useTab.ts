import { useCallback, useEffect, useState } from 'react';

export const TABS = ['overview', 'timeline', 'deliveries', 'disputes', 'match'] as const;
export type Tab = (typeof TABS)[number];

/** The tab named in the address (`#deliveries`); anything unknown falls back to the overview. */
export function parseTab(hash: string): Tab {
  const name = hash.replace(/^#/, '');
  return (TABS as readonly string[]).includes(name) ? (name as Tab) : 'overview';
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
