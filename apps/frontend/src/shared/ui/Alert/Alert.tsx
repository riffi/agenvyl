import type { HTMLAttributes } from 'react';
import styles from './Alert.module.css';

export function Alert({ tone = 'error', className = '', children, ...props }: HTMLAttributes<HTMLDivElement> & { tone?: 'error' | 'warning' }) {
  return <div className={`${styles.alert} ${styles[tone]} ${className}`} role="alert" {...props}>{tone === 'error' ? '⚠ ' : '⚠ '}{children}</div>;
}
