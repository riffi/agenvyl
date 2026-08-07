import { FileMinus2, FilePenLine, FilePlus2, Files } from 'lucide-react';
import { useState } from 'react';
import type { RunArtifact,RunArtifactSummary } from '@agenvyl/contracts';
import type { WorkspaceTarget } from '../workspace-window';
import styles from './Timeline.module.css';

const initiallyVisible = 4;

const changeMeta = {
  created: { label: 'Created', icon: FilePlus2 },
  updated: { label: 'Updated', icon: FilePenLine },
  deleted: { label: 'Deleted', icon: FileMinus2 },
} as const;

export const RunFiles = ({
  files,
  summary,
  openWorkspace,
}: {
  files: RunArtifact[];
  summary?:RunArtifactSummary;
  openWorkspace: (target: WorkspaceTarget) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  if (!files.length&&!summary?.total_count) return null;

  const visibleFiles = expanded ? files : files.slice(0, initiallyVisible);
  const hiddenCount = files.length - visibleFiles.length;

  return <section className={styles['run-files']} aria-label="Files changed by agent">
    <span className={styles['run-files-label']}><Files aria-hidden="true" />Changed files</span>
    <span className={styles['run-files-content']}>
    <span className={`${styles['run-files-list']} ${expanded?styles['run-files-list-expanded']:''}`}>
      {visibleFiles.map(file => {
        const meta = changeMeta[file.change];
        const ChangeIcon = meta.icon;
        return <button
          key={file.version_id}
          type="button"
          className={`${styles['run-file']} ${styles[`run-file-${file.change}`]}`}
          title={`${meta.label}: ${file.path}`}
          onClick={() => openWorkspace({
            entryId: file.entry_id,
            versionId: file.version_id,
            snapshotId: file.snapshot_id,
            path: file.path,
          })}
        >
          <ChangeIcon aria-hidden="true" />
          <span>{file.name}</span>
        </button>;
      })}
      {hiddenCount > 0 && <button type="button" className={styles['run-files-more']} onClick={() => setExpanded(true)} aria-expanded={false}>Show {hiddenCount} more</button>}
      {expanded && files.length > initiallyVisible && <button type="button" className={styles['run-files-more']} onClick={() => setExpanded(false)} aria-expanded={true}>Show less</button>}
    </span>
    <small className={styles['run-files-summary']}>{summary?.project_count??files.length} project {(summary?.project_count??files.length)===1?'file':'files'}{Boolean(summary?.hidden_count)&&<> · {summary!.hidden_count} non-project files hidden</>}</small>
    </span>
  </section>;
};
