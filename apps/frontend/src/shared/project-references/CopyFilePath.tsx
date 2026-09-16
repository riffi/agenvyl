import {useState} from 'react';
import styles from './CopyFilePath.module.css';

export const CopyFilePath = ({path}: {path: string}) => {
  const [status, setStatus] = useState('');
  return <span className={styles.control}>
    <button className={styles.button} type="button" title={path} aria-label={`Copy path: ${path}`} onClick={async () => {
      try { await navigator.clipboard.writeText(path); setStatus('Path copied'); }
      catch { setStatus(`Could not copy. Path: ${path}`); }
    }}>Copy path</button>
    {status && <span role="status"> {status}</span>}
  </span>;
};
