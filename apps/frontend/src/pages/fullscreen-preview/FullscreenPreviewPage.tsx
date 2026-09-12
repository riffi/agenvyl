import { Navigate, useParams } from 'react-router-dom';
import { IsolatedHtmlPreview } from '../../shared/features';
import styles from './FullscreenPreviewPage.module.css';

export function FullscreenPreviewPage() {
  const { roomId, runId } = useParams();

  if (!roomId || !runId) return <Navigate to="/" replace />;

  const previewUrl = `/api/v1/rooms/${encodeURIComponent(roomId)}/runs/${encodeURIComponent(runId)}/preview/`;

  return <main className={styles.page} aria-label="Full-screen app preview">
    <IsolatedHtmlPreview className={styles.frame} title="Full-screen app preview" previewUrl={previewUrl} />
  </main>;
}
