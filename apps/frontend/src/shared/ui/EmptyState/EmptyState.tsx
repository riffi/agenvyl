import type { ReactNode } from 'react';
import { CircleDashed } from 'lucide-react';
import styles from './EmptyState.module.css';

export function EmptyState({ icon = <CircleDashed />, title, description, action, compact = false, className = '' }: { icon?: ReactNode; title: ReactNode; description: ReactNode; action?: ReactNode; compact?: boolean; className?: string }) {
  return <section className={`${styles.empty} ${compact ? styles.compact : styles.page} ${className}`}><b>{icon}</b><h2>{title}</h2><div className={styles.description}>{description}</div>{action}</section>;
}
