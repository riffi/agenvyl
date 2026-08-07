import { useRef, type FocusEventHandler } from 'react';
import { ChevronDown, History, RotateCcw } from 'lucide-react';
import type { WorkspaceBuildPreview } from '@agenvyl/contracts';
import styles from './WorkspaceWindow.module.css';

export const WorkspaceBuildPicker = ({
  builds,
  selected,
  currentRunId,
  historical,
  onSelect,
  onBack,
}: {
  builds: WorkspaceBuildPreview[];
  selected?: WorkspaceBuildPreview;
  currentRunId?: string;
  historical: boolean;
  onSelect: (runId: string) => void;
  onBack: () => void;
}) => {
  const pickerRef = useRef<HTMLDetailsElement>(null);
  if (!selected) return null;
  const selectedIndex = builds.findIndex(build => build.runId === selected.runId);

  return <div className={styles.buildHeaderControls}>
    {historical && <span className={styles.historicalBuildTag}>Historical</span>}
    <details ref={pickerRef} className={styles.buildPicker} onBlur={closeOutside}>
      <summary role="button" aria-label="Choose app build" title={`Build ${builds.length - selectedIndex} of ${builds.length} · @${selected.agent} · ${formatDate(selected.createdAt)}`}>
        <span>Build {builds.length - selectedIndex}/{builds.length}</span>
        <small>@{selected.agent}</small>
        <ChevronDown aria-hidden="true"/>
      </summary>
      <div className={styles.buildPopover}>
        <header><span><History aria-hidden="true"/><strong>Build history</strong></span><small>{builds.length} {builds.length === 1 ? 'build' : 'builds'}</small></header>
        <div>
          {builds.map((build,index) => {
            const active = build.runId === selected.runId;
            return <button key={build.runId} className={active ? styles.buildSelected : ''} aria-pressed={active} onClick={() => {
              pickerRef.current?.removeAttribute('open');
              onSelect(build.runId);
            }}>
              <span className={styles.buildNumber}>#{builds.length - index}</span>
              <span className={styles.buildMeta}><strong>@{build.agent}</strong><small>{formatDate(build.createdAt)}</small></span>
              <span className={styles.buildBadges}>
                {build.runId === currentRunId && <em>Current</em>}
                <em>{runStatusLabel(build.runStatus)}</em>
                <em>{publishStatusLabel(build.publishStatus)}</em>
                {build.sameBuildAsPrevious && <em>Same build as previous</em>}
              </span>
            </button>;
          })}
        </div>
      </div>
    </details>
    {historical && <button type="button" className={styles.buildBack} aria-label="Back to current build" title="Back to current build" onClick={onBack}><RotateCcw aria-hidden="true"/></button>}
  </div>;
};

const formatDate = (value: string) => new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const runStatusLabel = (status: WorkspaceBuildPreview['runStatus']) => status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : status === 'cancelled' ? 'Cancelled' : 'Captured';
const publishStatusLabel = (status: WorkspaceBuildPreview['publishStatus']) => status === 'published' ? 'Applied' : status === 'partially_published' ? 'Partially applied' : status === 'noop' ? 'No source changes' : 'Not applied';

const closeOutside: FocusEventHandler<HTMLDetailsElement> = event => {
  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute('open');
};
