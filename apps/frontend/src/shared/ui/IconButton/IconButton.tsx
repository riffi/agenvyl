import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './IconButton.module.css';

export function IconButton({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { 'aria-label': string; children: ReactNode }) {
  return <button className={`${styles.button} ${className}`} {...props}>{children}</button>;
}
