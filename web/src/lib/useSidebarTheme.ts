import { useEffect, useState } from 'react';

export type SidebarMode = 'light' | 'dark';

function currentMode(): SidebarMode {
  return document.documentElement.dataset.sidebarMode === 'dark' ? 'dark' : 'light';
}

/** Follows the active sidebar theme without duplicating its storage logic. */
export function useSidebarThemeMode(): SidebarMode {
  const [mode, setMode] = useState<SidebarMode>(currentMode);

  useEffect(() => {
    const update = () => setMode(currentMode());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-sidebar-mode'] });
    update();
    return () => observer.disconnect();
  }, []);

  return mode;
}
