import { useSyncExternalStore } from 'react';

const query = '(max-width: 899px)';
const snapshot = () => typeof matchMedia === 'function' && matchMedia(query).matches;
const subscribe = (onChange: () => void) => {
  if (typeof matchMedia !== 'function') return () => {};
  const media = matchMedia(query);
  media.addEventListener?.('change', onChange);
  return () => media.removeEventListener?.('change', onChange);
};

export const useCompactWorkspace = () => useSyncExternalStore(subscribe, snapshot, () => false);
