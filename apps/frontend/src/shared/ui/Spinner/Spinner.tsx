import styles from './Spinner.module.css';

export function Spinner({ label = 'Загрузка…' }: { label?: string }) {
  return <span className={styles.spinner} role="status"><i aria-hidden />{label}</span>;
}
