import { useCallback, useEffect, useState } from 'react';

const preferenceKey = 'agenvyl.sidebar.collapsed';
const desktopQuery = '(min-width: 768px)';

const readPreference = () => {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(preferenceKey) === 'true';
  } catch {
    return false;
  }
};

export const useSidebarCollapse = () => {
  const [preferredCollapsed, setPreferredCollapsed] = useState(readPreference);
  const [desktop, setDesktop] = useState(() => typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia(desktopQuery).matches);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(desktopQuery);
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const toggle = useCallback(() => setPreferredCollapsed(current => {
    const next = !current;
    try { window.localStorage.setItem(preferenceKey, String(next)); } catch { /* The preference remains session-local when storage is unavailable. */ }
    return next;
  }), []);

  return { collapsed: desktop && preferredCollapsed, toggle };
};
