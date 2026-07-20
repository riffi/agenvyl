import { useEffect, type MouseEvent, type ReactNode } from 'react';
import { Button } from '../Button';
import styles from './Dialog.module.css';

export function Dialog({ open = true, title, description, children, footer, onClose, labelledBy }: { open?: boolean; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; labelledBy?: string }) {
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; addEventListener('keydown', close); return () => removeEventListener('keydown', close); }, [open, onClose]);
  if (!open) return null;
  const titleId = labelledBy ?? 'dialog-title';
  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose(); };
  return <div className={styles.backdrop} role="presentation" onMouseDown={closeOnBackdrop}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className={styles.header}><span><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</span><Button variant="ghost" className={styles.close} onClick={onClose} aria-label="Закрыть">×</Button></header>
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </section>
  </div>;
}
