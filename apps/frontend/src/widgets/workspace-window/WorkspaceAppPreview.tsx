import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, Layers3 } from 'lucide-react';
import type { RoomStaticPreview, WorkspaceBuildPreview } from '@agenvyl/contracts';
import { IsolatedHtmlPreview } from '../../shared/features';
import type { WorkspacePreviewDevice } from './workspaceModel';
import styles from './WorkspaceWindow.module.css';
import deviceStyles from './WorkspaceAppPreview.module.css';

export const WorkspaceAppPreview = ({
  selected,
  device = 'desktop',
  latestOutdated,
  staticPreview,
  selectedRunId,
  onSelect,
  onFiles,
}: {
  selected?: WorkspaceBuildPreview;
  device?: WorkspacePreviewDevice;
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
      : staticPreview?.status==='build_missing'&&!selectedRunId
        ? <div className={styles.previewGate}><span className={styles.previewGateIcon}><Layers3 aria-hidden="true"/></span><strong>No build for the current workspace</strong><p>Build the current source to create a preview. Saved builds remain available in build history.</p><div><button type="button" onClick={onFiles}>View files</button></div></div>
      : selected
        ? <AppPreviewDevice selected={selected} device={device} />
        : <div className={styles.previewGate}>
          <span className={styles.previewGateIcon}><Layers3 aria-hidden="true"/></span>
          <strong>App preview unavailable</strong>
          <p>No captured app build was found in this room.</p>
          <div><button type="button" onClick={onFiles}>View files</button></div>
        </div>}
  </section>;
};

const AppPreviewDevice = ({ selected, device }: { selected: WorkspaceBuildPreview; device: WorkspacePreviewDevice }) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const mobile = device === 'mobile';

  useEffect(() => {
    const stage = stageRef.current;
    if (!mobile || !stage) return;
    const resize = () => {
      // Keep the 390 × 844 CSS-pixel viewport intact; scale the entire phone to fit.
      setScale(Math.max(0, Math.min(1, (stage.clientWidth - 48) / 414, (stage.clientHeight - 48) / 892)));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [mobile]);

  return <div ref={stageRef} className={`${deviceStyles.stage} ${mobile ? deviceStyles.mobile : ''}`} style={{ '--preview-scale': scale } as CSSProperties}>
    <div className={deviceStyles.device}>
      <div className={deviceStyles.screen}>
        <IsolatedHtmlPreview className={styles.appPreviewFrame} title={`App build by @${selected.agent}`} previewUrl={selected.attachment.preview_url} />
      </div>
    </div>
  </div>;
};
