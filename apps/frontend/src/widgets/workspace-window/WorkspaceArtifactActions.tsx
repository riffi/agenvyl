import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, MoreHorizontal } from 'lucide-react';
import type { WorkspaceAttachment } from '@agenvyl/contracts';
import type { WorkspaceTarget } from './workspaceModel';
import styles from './WorkspaceArtifactActions.module.css';

export const WorkspaceArtifactActions = ({ attachment, openWorkspace, className = '' }: {
  attachment: WorkspaceAttachment;
  openWorkspace: (target: WorkspaceTarget) => void;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeMenu = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return <span ref={rootRef} className={`${styles.root} ${className}`}>
    <button type="button" className={styles.trigger} aria-label={`Actions for ${attachment.name}`} aria-expanded={open} onClick={event => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setPosition({ top: Math.min(rect.bottom + 4, innerHeight - 80), left: Math.max(8, rect.right - 170) });
      setOpen(value => !value);
    }}><MoreHorizontal /></button>
    {open && createPortal(<span ref={menuRef} className={styles.menu} style={position} role="menu">
      <button type="button" role="menuitem" onClick={event => {
        event.stopPropagation();
        setOpen(false);
        openWorkspace({ entryId: attachment.entry_id, versionId: attachment.version_id, snapshotId: attachment.snapshot_id, path: attachment.path });
      }}><FolderOpen />Open in Workspace</button>
      <a role="menuitem" href={attachment.url} download onClick={event => { event.stopPropagation(); setOpen(false); }}><Download />Download</a>
    </span>, document.body)}
  </span>;
};
