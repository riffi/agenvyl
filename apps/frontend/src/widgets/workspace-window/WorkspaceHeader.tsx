import { useRef, type FocusEventHandler, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  Eye,
  ExternalLink,
  FolderInput,
  FolderOpen,
  History,
  MoreHorizontal,
  Monitor,
  PanelLeft,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import type { WorkspaceAttachment, WorkspaceBuildPreview, WorkspaceEntry, WorkspaceHistory, WorkspaceRestoreTarget, WorkspaceVersion } from '@agenvyl/contracts';
import { IconButton } from '../../shared/ui';
import { workspaceModesFor, type WorkspacePreviewDevice, type WorkspaceSection, type WorkspaceViewMode } from './workspaceModel';
import { useCompactWorkspace } from './useCompactWorkspace';
import { WorkspaceSectionSwitch } from './WorkspaceSectionSwitch';
import { WorkspaceBuildPicker } from './WorkspaceBuildPicker';
import styles from './WorkspaceWindow.module.css';

type WorkspaceHeaderProps = {
  sourceSelector?:ReactNode;
  section: WorkspaceSection;
  previewDevice: WorkspacePreviewDevice;
  onPreviewDevice: (device: WorkspacePreviewDevice) => void;
  treeVisible: boolean;
  entry?: WorkspaceEntry;
  attachment?: WorkspaceAttachment;
  versions: WorkspaceVersion[];
  current?: WorkspaceVersion;
  viewed?: WorkspaceVersion;
  mode: WorkspaceViewMode;
  deleted: boolean;
  canAttach: boolean;
  sourceOnly?: boolean;
  builds: WorkspaceBuildPreview[];
  selectedBuild?: WorkspaceBuildPreview;
  fullScreenPreviewUrl?: string;
  currentBuildRunId?: string;
  historicalBuild: boolean;
  onSection: (section: WorkspaceSection) => void;
  onBuild: (runId: string) => void;
  onCurrentBuild: () => void;
  onTreeToggle: () => void;
  onVersion: (version: WorkspaceVersion, followCurrent: boolean) => void;
  onMode: (mode: WorkspaceViewMode) => void;
  onRestoreVersion: () => void;
  onRestoreEntry: () => void;
  onAttach: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  history?: WorkspaceHistory;
  historyError?: string;
  onWorkspaceRestore?: (target: WorkspaceRestoreTarget, label: string, recovery?: boolean) => void;
  onClose: () => void;
};

export const WorkspaceHeader = ({
  sourceSelector,
  section,
  previewDevice,
  onPreviewDevice,
  treeVisible,
  entry,
  attachment,
  versions,
  current,
  viewed,
  mode,
  deleted,
  canAttach,
  sourceOnly = false,
  builds,
  selectedBuild,
  fullScreenPreviewUrl,
  currentBuildRunId,
  historicalBuild,
  onSection,
  onBuild,
  onCurrentBuild,
  onTreeToggle,
  onVersion,
  onMode,
  onRestoreVersion,
  onRestoreEntry,
  onAttach,
  onRename,
  onMove,
  onDelete,
  onRefresh,
  history,
  historyError,
  onWorkspaceRestore,
  onClose,
}: WorkspaceHeaderProps) => {
  const compact = useCompactWorkspace();
  const actionsRef = useRef<HTMLDetailsElement>(null);
  const versionsRef = useRef<HTMLDetailsElement>(null);
  const viewedIndex = Math.max(0, versions.findIndex(version => version.id === viewed?.id));
  const older = versions[viewedIndex + 1];
  const newer = versions[viewedIndex - 1];
  const versionNumber = versions.length ? versions.length - viewedIndex : 1;
  const modes = attachment ? sourceOnly ? ['source' as const] : workspaceModesFor(attachment) : [];
  const isHistorical = Boolean(viewed && current && viewed.id !== current.id);

  const action = (callback: () => void) => () => {
    actionsRef.current?.removeAttribute('open');
    callback();
  };

  return <header className={`${styles.globalHeader} ${section === 'app' ? styles.appHeader : treeVisible ? styles.treeHeader : styles.viewerHeader}`}>
    <div className={styles.headerLead}>
      {section === 'files' && <IconButton
        aria-label={treeVisible ? 'Hide workspace files' : 'Show workspace files'}
        title={treeVisible ? 'Hide files' : 'Show files'}
        className={treeVisible ? styles.treeToggleActive : ''}
        onClick={onTreeToggle}
      >
        <PanelLeft className={styles.desktopTreeIcon} />
        <ChevronLeft className={styles.mobileBackIcon} />
      </IconButton>}

      {sourceSelector?!compact&&<span className={styles.desktopSource}>{sourceSelector}</span>:<div className={styles.workspaceIdentity}>
        <FolderOpen className={styles.workspaceIcon} />
        <strong>Workspace</strong>
        {section === 'files' && attachment && <>
          <span className={styles.identityDivider}>/</span>
          <span className={styles.fileName} title={entry?.path ?? attachment.path}>{attachment.name}</span>
        </>}
      </div>}
    </div>

    <div className={styles.headerCenter}>
      <WorkspaceSectionSwitch section={section} onChange={onSection}/>
    </div>

    <div className={styles.headerControls}>
      {section === 'app' && <div className={`${styles.headerModeSwitch} ${styles.previewDeviceSwitch}`} role="group" aria-label="Preview device">
        <button type="button" aria-label="Desktop preview" title="Desktop" aria-pressed={previewDevice === 'desktop'} className={previewDevice === 'desktop' ? styles.headerModeActive : ''} onClick={() => onPreviewDevice('desktop')}><Monitor aria-hidden="true" /></button>
        <button type="button" aria-label="Mobile preview" title="Mobile" aria-pressed={previewDevice === 'mobile'} className={previewDevice === 'mobile' ? styles.headerModeActive : ''} onClick={() => onPreviewDevice('mobile')}><Smartphone aria-hidden="true" /></button>
      </div>}
      {section === 'app' && fullScreenPreviewUrl && <a
        className={`${styles.fullScreenPreviewLink} ${styles.desktopOnly}`}
        href={fullScreenPreviewUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open full-screen preview"
        title="Open full-screen preview"
      ><ExternalLink aria-hidden="true" /></a>}
      {section === 'files' && modes.length > 1 && <div className={styles.headerModeSwitch} aria-label="View mode">
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

      {section === 'files' && versions.length > 0 && <div className={styles.versionCarousel}>
        <IconButton aria-label="View older version" title="Older version" disabled={!older} onClick={() => older && onVersion(older, false)}><ChevronLeft /></IconButton>
        <details ref={versionsRef} className={styles.versionPicker} onBlur={closeOutside}>
          <summary role="button" aria-label={`Version ${versionNumber} of ${versions.length}`} title="Version history">
            <span>v{versionNumber}</span><i>/</i><span>{versions.length}</span>
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
                    {selected && version.id !== current?.id && <em>Viewing</em>}
                  </span>
                </button>;
              })}
            </div>
          </div>
        </details>
        <IconButton aria-label="View newer version" title="Newer version" disabled={!newer} onClick={() => newer && onVersion(newer, newer.id === current?.id)}><ChevronRight /></IconButton>
      </div>}
      {!compact && (section === 'app' || onWorkspaceRestore) && <span className={styles.desktopOnly}><WorkspaceBuildPicker builds={builds} selected={selectedBuild} currentRunId={currentBuildRunId} historical={historicalBuild} onSelect={onBuild} onBack={onCurrentBuild} history={history} historyError={historyError} onRestore={onWorkspaceRestore}/></span>}
      <IconButton className={styles.mobileRefresh} aria-label="Refresh workspace" onClick={onRefresh}><RefreshCw/></IconButton>
      <details ref={actionsRef} className={styles.workspaceMenu} onBlur={closeOutside}>
        <summary role="button" aria-label="Workspace actions" title="Workspace actions"><MoreHorizontal /></summary>
        <div className={styles.workspaceMenuPopover}>
          <section className={styles.mobileMenuSection}>
            {compact && sourceSelector}
            {compact && (section === 'app' || onWorkspaceRestore) && <WorkspaceBuildPicker builds={builds} selected={selectedBuild} currentRunId={currentBuildRunId} historical={historicalBuild} onSelect={onBuild} onBack={onCurrentBuild} history={history} historyError={historyError} onRestore={onWorkspaceRestore}/>}
            {section==='app'&&fullScreenPreviewUrl&&<a href={fullScreenPreviewUrl} target="_blank" rel="noopener noreferrer" onClick={()=>actionsRef.current?.removeAttribute('open')}><ExternalLink/>Open in new tab</a>}
          </section>
          {section === 'files' && attachment && <section>
            {versions.length > 0 && <button onClick={action(() => versionsRef.current?.setAttribute('open', ''))}><History />Version history</button>}
            {isHistorical && <button onClick={action(onRestoreVersion)}><RotateCcw />Restore this version</button>}
            {deleted && <button onClick={action(onRestoreEntry)}><RotateCcw />Restore file</button>}
          </section>}

          {section === 'files' && attachment && !deleted && <section>
            {canAttach && <button onClick={action(onAttach)}><Paperclip />Attach</button>}
            <a href={attachment.url} download onClick={() => actionsRef.current?.removeAttribute('open')}><Download />Download</a>
          </section>}

          {section === 'files' && entry && !deleted && <section>
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
