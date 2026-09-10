import { useRef, type FocusEventHandler } from 'react';
import { ChevronDown, History, RotateCcw } from 'lucide-react';
import type { WorkspaceBuildPreview, WorkspaceHistory, WorkspaceRestoreTarget } from '@agenvyl/contracts';
import styles from './WorkspaceWindow.module.css';

export const WorkspaceBuildPicker = ({
  builds,
  selected,
  currentRunId,
  historical,
  onSelect,
  onBack,
  history,
  historyError,
  onRestore,
}: {
  builds: WorkspaceBuildPreview[];
  selected?: WorkspaceBuildPreview;
  currentRunId?: string;
  historical: boolean;
  onSelect: (runId: string) => void;
  onBack: () => void;
  history?: WorkspaceHistory;
  historyError?: string;
  onRestore?: (target: WorkspaceRestoreTarget, label: string, recovery?: boolean) => void;
}) => {
  const pickerRef = useRef<HTMLDetailsElement>(null);
  const selectedIndex = builds.findIndex(build => build.runId === selected?.runId);
  const extraItems = history?.items.filter(item => item.kind === 'restore' || !builds.some(build => build.runId === item.id)) ?? [];
  const restoreAction = (item: WorkspaceHistory['items'][number], label: string) => {
    const recovery = item.kind === 'restore' && item.status === 'pending';
    const reason = recovery ? undefined : item.unavailableReason ?? history?.unavailableReason;
    const actionLabel = recovery ? 'Retry recovery' : item.kind === 'run' ? 'Undo this run' : 'Restore to before this rollback';
    return <span className={styles.buildRestore} title={reason ?? actionLabel}>
      <button type="button" disabled={Boolean(reason)} aria-label={actionLabel} aria-description={reason} aria-haspopup="dialog" onClick={() => {
        pickerRef.current?.removeAttribute('open');
        pickerRef.current?.querySelector('summary')?.focus();
        onRestore?.({kind:item.kind,id:item.id},label,recovery);
      }}><RotateCcw aria-hidden="true"/></button>
    </span>;
  };

  return <div className={styles.buildHeaderControls}>
    {historical && <span className={styles.historicalBuildTag}>Historical</span>}
    <details ref={pickerRef} className={styles.buildPicker} onBlur={closeOutside}>
      <summary role="button" aria-label="Choose app build" title={selected ? `Build ${builds.length - selectedIndex} of ${builds.length} · @${selected.agent} · ${formatDate(selected.createdAt)}` : 'Builds and workspace changes'}>
        <span>{selected ? `Build ${builds.length - selectedIndex}/${builds.length}` : 'Builds & changes'}</span>
        {selected && <small>@{selected.agent}</small>}
        <ChevronDown aria-hidden="true"/>
      </summary>
      <div className={styles.buildPopover}>
        <header><span><History aria-hidden="true"/><strong>Build history</strong></span><small>{builds.length} {builds.length === 1 ? 'build' : 'builds'}</small></header>
        <div>
          {onRestore && !history && !historyError && <p className={styles.buildNotice} role="status">Loading restore actions…</p>}
          {historyError && <p className={styles.buildNotice} role="alert">{historyError}</p>}
          {history?.unavailableReason && <p className={styles.buildNotice} role="status">{history.unavailableReason}</p>}
          {builds.map((build,index) => {
            const active = build.runId === selected?.runId;
            const run = history?.items.find(item => item.kind === 'run' && item.id === build.runId);
            return <div key={build.runId} className={styles.buildRow}>
            <button className={active ? styles.buildSelected : ''} aria-pressed={active} onClick={() => {
              pickerRef.current?.removeAttribute('open');
              onSelect(build.runId);
            }}>
              <span className={styles.buildNumber}>#{builds.length - index}</span>
              <span className={styles.buildMeta}><strong>@{build.agent}</strong><small>{formatDate(build.createdAt)}</small></span>
              <span className={styles.buildBadges}>
                {build.runId === currentRunId && <em>Current</em>}
                <em>{runStatusLabel(build.runStatus)}</em>
                {build.sameBuildAsPrevious && <em>Same build as previous</em>}
              </span>
            </button>
            {onRestore && run && restoreAction(run,`Build #${builds.length-index} · @${build.agent} · ${formatDate(build.createdAt)}`)}
            </div>;
          })}
          {onRestore && extraItems.length > 0 && <section className={styles.buildOtherChanges}>
            <h3>Other workspace changes</h3>
            {extraItems.map(item => <div key={`${item.kind}-${item.id}`} className={styles.buildRow}>
              <div className={styles.buildNotice}><strong>{item.kind === 'run' ? `@${item.agent} · No saved build` : 'Workspace restored'}</strong><small>{formatDate(item.createdAt)} · {item.status === 'pending' ? 'Recovery pending' : item.status}</small>{item.kind === 'restore' && item.error && <small>{item.error}</small>}</div>
              {restoreAction(item,`${item.kind === 'run' ? `@${item.agent} · No saved build` : 'Workspace restored'} · ${formatDate(item.createdAt)}`)}
            </div>)}
          </section>}
          {!builds.length && history?.items.length === 0 && <p className={styles.buildNotice}>No builds or workspace changes yet.</p>}
        </div>
      </div>
    </details>
    {historical && <button type="button" className={styles.buildBack} aria-label="Back to current build" title="Back to current build" onClick={onBack}><RotateCcw aria-hidden="true"/></button>}
  </div>;
};

const formatDate = (value: string) => new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const runStatusLabel = (status: WorkspaceBuildPreview['runStatus']) => status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : status === 'cancelled' ? 'Cancelled' : 'Captured';

const closeOutside: FocusEventHandler<HTMLDetailsElement> = event => {
  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute('open');
};
