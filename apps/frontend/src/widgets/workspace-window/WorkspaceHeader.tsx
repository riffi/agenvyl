import { useRef, type FocusEventHandler } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  Eye,
  FolderInput,
  FolderOpen,
  History,
  MoreHorizontal,
  PanelLeft,
  Paperclip,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import type { WorkspaceAttachment, WorkspaceEntry, WorkspaceVersion } from '@agenvyl/contracts';
import { IconButton } from '../../shared/ui';
import { workspaceModesFor, type WorkspaceViewMode } from './workspaceModel';
import styles from './WorkspaceWindow.module.css';

type WorkspaceHeaderProps = {
  treeVisible: boolean;
  entry?: WorkspaceEntry;
  attachment?: WorkspaceAttachment;
  versions: WorkspaceVersion[];
  current?: WorkspaceVersion;
  viewed?: WorkspaceVersion;
  mode: WorkspaceViewMode;
  approvedVersionId?: string;
  planModeEnabled: boolean;
  deleted: boolean;
  editingPlan: boolean;
  canAttach: boolean;
  onTreeToggle: () => void;
  onVersion: (version: WorkspaceVersion, followCurrent: boolean) => void;
  onMode: (mode: WorkspaceViewMode) => void;
  onRestoreVersion: () => void;
  onRestoreEntry: () => void;
  onEditPlan: () => void;
  onAttach: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onClose: () => void;
};

export const WorkspaceHeader = ({
  treeVisible,
  entry,
  attachment,
  versions,
  current,
  viewed,
  mode,
  approvedVersionId,
  planModeEnabled,
  deleted,
  editingPlan,
  canAttach,
  onTreeToggle,
  onVersion,
  onMode,
  onRestoreVersion,
  onRestoreEntry,
  onEditPlan,
  onAttach,
  onRename,
  onMove,
  onDelete,
  onRefresh,
  onClose,
}: WorkspaceHeaderProps) => {
  const actionsRef = useRef<HTMLDetailsElement>(null);
  const versionsRef = useRef<HTMLDetailsElement>(null);
  const viewedIndex = Math.max(0, versions.findIndex(version => version.id === viewed?.id));
  const older = versions[viewedIndex + 1];
  const newer = versions[viewedIndex - 1];
  const versionNumber = versions.length ? versions.length - viewedIndex : 1;
  const modes = attachment ? workspaceModesFor(attachment) : [];
  const isPlan = planModeEnabled && entry?.path === 'plan.md';
  const isHistorical = Boolean(viewed && current && viewed.id !== current.id);

  const action = (callback: () => void) => () => {
    actionsRef.current?.removeAttribute('open');
    callback();
  };

  return <header className={`${styles.globalHeader} ${treeVisible ? styles.treeHeader : styles.viewerHeader}`}>
    <div className={styles.headerLead}>
      <IconButton
        aria-label={treeVisible ? 'Hide workspace files' : 'Show workspace files'}
        title={treeVisible ? 'Hide files' : 'Show files'}
        className={treeVisible ? styles.treeToggleActive : ''}
        onClick={onTreeToggle}
      >
        <PanelLeft className={styles.desktopTreeIcon} />
        <ChevronLeft className={styles.mobileBackIcon} />
      </IconButton>

      <div className={styles.workspaceIdentity}>
        <FolderOpen className={styles.workspaceIcon} />
        <strong>Workspace</strong>
        {attachment && <>
          <span className={styles.identityDivider}>/</span>
          <span className={styles.fileName} title={entry?.path ?? attachment.path}>{attachment.name}</span>
        </>}
      </div>
    </div>

    <div className={styles.headerCenter}>
      {modes.length > 1 && <div className={styles.headerModeSwitch} aria-label="View mode">
        <button
          aria-label="Rendered"
          title="Rendered"
          className={mode === 'rendered' ? styles.headerModeActive : ''}
          aria-pressed={mode === 'rendered'}
          onClick={() => onMode('rendered')}
        ><Eye /></button>
        <button
          aria-label="Source"
          title="Source"
          className={mode === 'source' ? styles.headerModeActive : ''}
          aria-pressed={mode === 'source'}
          onClick={() => onMode('source')}
        ><Code2 /></button>
      </div>}

      {versions.length > 0 && <div className={styles.versionCarousel}>
        <IconButton aria-label="View older version" title="Older version" disabled={!older} onClick={() => older && onVersion(older, false)}><ChevronLeft /></IconButton>
        <details ref={versionsRef} className={styles.versionPicker} onBlur={closeOutside}>
          <summary role="button" aria-label={`Version ${versionNumber} of ${versions.length}`} title="Version history">
            <span>{versionNumber}</span><i>/</i><span>{versions.length}</span>
          </summary>
          <div className={styles.versionPopover}>
            <header><strong>Version history</strong><span>{versions.length} versions</span></header>
            <div>
              {versions.map((version, index) => {
                const number = versions.length - index;
                const selected = version.id === viewed?.id;
                return <button
                  key={version.id}
                  className={selected ? styles.versionSelected : ''}
                  aria-pressed={selected}
                  onClick={() => {
                    versionsRef.current?.removeAttribute('open');
                    onVersion(version, version.id === current?.id);
                  }}
                >
                  <span className={styles.versionNumber}>v{number}</span>
                  <span className={styles.versionMeta}>
                    <strong>{version.source}</strong>
                    <small>{new Date(version.created_at).toLocaleString()}</small>
                  </span>
                  <span className={styles.versionBadges}>
                    {version.id === current?.id && <em>Current</em>}
                    {version.id === approvedVersionId && <em>Approved</em>}
                    {selected && version.id !== current?.id && <em>Viewing</em>}
                  </span>
                </button>;
              })}
            </div>
          </div>
        </details>
        <IconButton aria-label="View newer version" title="Newer version" disabled={!newer} onClick={() => newer && onVersion(newer, newer.id === current?.id)}><ChevronRight /></IconButton>
      </div>}
    </div>

    <div className={styles.headerControls}>
      <details ref={actionsRef} className={styles.workspaceMenu} onBlur={closeOutside}>
        <summary role="button" aria-label="Workspace actions" title="Workspace actions"><MoreHorizontal /></summary>
        <div className={styles.workspaceMenuPopover}>
          {attachment && <section>
            {versions.length > 0 && <button onClick={action(() => versionsRef.current?.setAttribute('open', ''))}><History />Version history</button>}
            {isHistorical && <button onClick={action(onRestoreVersion)}><RotateCcw />Restore this version</button>}
            {deleted && <button onClick={action(onRestoreEntry)}><RotateCcw />Restore file</button>}
          </section>}

          {attachment && !deleted && <section>
            {canAttach && <button onClick={action(onAttach)}><Paperclip />Attach</button>}
            <a href={attachment.url} download onClick={() => actionsRef.current?.removeAttribute('open')}><Download />Download</a>
            {isPlan && viewed?.id === current?.id && !editingPlan && <button onClick={action(onEditPlan)}><Pencil />Edit plan.md</button>}
          </section>}

          {entry && !deleted && !isPlan && <section>
            <button onClick={action(onRename)}><Type />Rename</button>
            <button onClick={action(onMove)}><FolderInput />Move</button>
            <button className={styles.dangerItem} onClick={action(onDelete)}><Trash2 />Delete</button>
          </section>}

          <section>
            <button onClick={action(onRefresh)}><RefreshCw />Refresh workspace</button>
          </section>
        </div>
      </details>

      <IconButton aria-label="Close workspace" title="Close workspace" onClick={onClose}>
        <X />
      </IconButton>
    </div>
  </header>;
};

const closeOutside: FocusEventHandler<HTMLDetailsElement> = event => {
  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute('open');
};
