import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileWarning, WrapText } from 'lucide-react';
import type { WorkspaceAttachment } from '@agenvyl/contracts';
import { IconButton } from '../../shared/ui';
import { decodeWorkspaceBytes, detectWorkspaceEncoding, SOURCE_HIGHLIGHT_LIMIT, SOURCE_PREVIEW_LIMIT, WORKSPACE_ENCODINGS } from './workspaceText';
import type { WorkspaceEncoding } from './workspaceModel';
import { workspaceLanguageFor } from './workspaceModel';
import styles from './WorkspaceContent.module.css';

const DesktopSourceViewer = lazy(() => import('./DesktopSourceViewer'));
const MobileSourceViewer = lazy(() => import('./MobileSourceViewer'));

type BytesState = { bytes?: Uint8Array; error?: string };

export const useWorkspaceBytes = (url: string) => {
  const [state, setState] = useState<BytesState>({});
  useEffect(() => {
    const controller = new AbortController();
    setState({});
    fetch(url, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(value => setState({ bytes: new Uint8Array(value) }))
      .catch(error => {
        if ((error as Error).name !== 'AbortError') setState({ error: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [url]);
  return state;
};

export const useCompactSourceViewer = () => {
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 899px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width: 899px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
};

export const SourceViewer = ({
  attachment,
  encoding,
  onEncodingChange,
}: {
  attachment: WorkspaceAttachment;
  encoding?: WorkspaceEncoding;
  onEncodingChange?: (encoding?: WorkspaceEncoding) => void;
}) => {
  const state = useWorkspaceBytes(attachment.url);
  const compact = useCompactSourceViewer();
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const decoded = useMemo(() => {
    if (!state.bytes || state.bytes.byteLength > SOURCE_PREVIEW_LIMIT) return undefined;
    return decodeWorkspaceBytes(state.bytes, encoding);
  }, [encoding, state.bytes]);
  const detected = useMemo(() => state.bytes ? detectWorkspaceEncoding(state.bytes) : undefined, [state.bytes]);

  if (state.error) return <SourceMessage title="Could not load source" detail={state.error} />;
  if (!state.bytes) return <div className={styles.sourceLoading}>Loading source…</div>;
  if (state.bytes.byteLength > SOURCE_PREVIEW_LIMIT) {
    return <SourceMessage title="Source is too large to preview" detail="Files larger than 5 MiB are available as downloads." />;
  }

  const text = decoded?.text ?? '';
  const highlighted = state.bytes.byteLength <= SOURCE_HIGHLIGHT_LIMIT;
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return <section className={styles.sourceViewer}>
    <header className={styles.sourceToolbar}>
      <label>
        <span>Encoding</span>
        <select value={encoding ?? 'auto'} onChange={event => onEncodingChange?.(event.target.value === 'auto' ? undefined : event.target.value as WorkspaceEncoding)}>
          <option value="auto">Auto ({WORKSPACE_ENCODINGS.find(item => item.value === detected)?.label ?? detected})</option>
          {WORKSPACE_ENCODINGS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {!highlighted && <small>Highlighting disabled above 1 MiB</small>}
      <IconButton aria-label="Toggle line wrapping" title="Wrap lines" className={wrap ? styles.sourceActionActive : ''} onClick={() => setWrap(value => !value)}><WrapText /></IconButton>
      <IconButton aria-label="Copy source" title="Copy source" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}</IconButton>
    </header>
    <div className={styles.sourceBody}>
      {!highlighted
        ? <pre className={`${styles.plainSource} ${wrap ? styles.wrapped : ''}`}>{text}</pre>
        : <Suspense fallback={<div className={styles.sourceLoading}>Loading code viewer…</div>}>
            {compact
              ? <MobileSourceViewer text={text} language={workspaceLanguageFor(attachment.path, attachment.mime_type)} label={attachment.name} wrap={wrap} />
              : <DesktopSourceViewer text={text} language={workspaceLanguageFor(attachment.path, attachment.mime_type)} label={attachment.name} wrap={wrap} />}
          </Suspense>}
    </div>
  </section>;
};

const SourceMessage = ({ title, detail }: { title: string; detail: string }) =>
  <div className={styles.sourceMessage}><FileWarning /><strong>{title}</strong><span>{detail}</span></div>;
