import type { ReactNode } from 'react';
import { Button } from '../Button';
import styles from './Drawer.module.css';

export function Drawer({ open, title, leading, children, onClose, wide = false, specBlockId }: { open: boolean; title: ReactNode; leading?: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean; specBlockId?: string }) {
  return <aside className={`${styles.drawer} ${open ? styles.open : ''} ${wide ? styles.wide : ''}`} ui-spec-block-id={specBlockId} aria-hidden={!open}>
    <header>{leading}<strong>{title}</strong><Button variant="ghost" className={styles.close} onClick={onClose} aria-label="Закрыть">×</Button></header>
    <div className={styles.content}>{children}</div>
  </aside>;
}
