import { AlertTriangle, Layers3 } from 'lucide-react';
import type { RoomStaticPreview, WorkspaceBuildPreview } from '@agenvyl/contracts';
import { IsolatedHtmlPreview } from '../../shared/features';
import styles from './WorkspaceWindow.module.css';

export const WorkspaceAppPreview = ({
  selected,
  latestOutdated,
  staticPreview,
  selectedRunId,
  onSelect,
  onFiles,
}: {
  selected?: WorkspaceBuildPreview;
  latestOutdated?: WorkspaceBuildPreview;
  staticPreview?: RoomStaticPreview;
  selectedRunId?: string;
  onSelect: (runId?: string) => void;
  onFiles: () => void;
}) => {
  const showOutdatedGate = staticPreview?.status === 'outdated' && !selectedRunId;

  return <section className={styles.appPreview} aria-label="App preview">
    {showOutdatedGate
      ? <div className={styles.previewGate}>
        <span className={styles.previewGateIcon}><AlertTriangle aria-hidden="true"/></span>
        <strong>App preview is out of date</strong>
        <p>Source files changed after this build.</p>
        <div><button type="button" className={styles.primaryPreviewAction} disabled={!latestOutdated} onClick={() => latestOutdated && onSelect(latestOutdated.runId)}>Open latest build anyway</button><button type="button" onClick={onFiles}>View files</button></div>
      </div>
      : selected
        ? <IsolatedHtmlPreview className={styles.appPreviewFrame} title={`App build by @${selected.agent}`} previewUrl={selected.attachment.preview_url}/>
        : <div className={styles.previewGate}>
          <span className={styles.previewGateIcon}><Layers3 aria-hidden="true"/></span>
          <strong>App preview unavailable</strong>
          <p>No captured app build was found in this room.</p>
          <div><button type="button" onClick={onFiles}>View files</button></div>
        </div>}
  </section>;
};
