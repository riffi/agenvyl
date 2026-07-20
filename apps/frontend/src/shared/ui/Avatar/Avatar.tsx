import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './Avatar.module.css';

export function Avatar({ label, color, size = 'md', className = '', style, ...props }: HTMLAttributes<HTMLSpanElement> & { label: string; color: string; size?: 'sm' | 'md' }) {
  return <span className={`${styles.avatar} ${styles[size]} ${className}`} style={{ '--avatar-color': color, ...style } as CSSProperties} {...props}>{label.slice(0, 1)}</span>;
}
