import type { ReactNode } from 'react';
import styles from './AppShell.module.css';

export function AppShell({ children }: { children: ReactNode }) {
  return <div className={styles.app}>{children}</div>;
}
