import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent, type ReactNode } from 'react';
import { Download, File, FolderOpen, MoreHorizontal, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Lightbox from 'yet-another-react-lightbox';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import type { WorkspaceAttachment } from '@agenvyl/contracts';
import {IsolatedHtmlPreview} from '../../shared/features';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';
import 'yet-another-react-lightbox/plugins/counter.css';
import styles from './ArtifactViewer.module.css';

export type ArtifactViewerRequest = {
  attachment: WorkspaceAttachment;
  gallery?: WorkspaceAttachment[];
  opener?: HTMLElement | null;
};

export type OpenArtifact = (
  attachment: WorkspaceAttachment,
  gallery?: WorkspaceAttachment[],
  opener?: HTMLElement | null,
) => void;

export type ArtifactRendererProps = { attachment: WorkspaceAttachment };
export type ArtifactRenderer = {
  id: string;
  matches: (attachment: WorkspaceAttachment) => boolean;
  component: ComponentType<ArtifactRendererProps>;
};

const isImage = (attachment: WorkspaceAttachment) => attachment.mime_type.startsWith('image/');

export const resolveArtifactRenderer = (
  attachment: WorkspaceAttachment,
  renderers: ArtifactRenderer[] = [],
) => [...renderers, ...builtInRenderers].find(renderer => renderer.matches(attachment))!;

export const ArtifactViewer = ({
  request,
  close,
  openWorkspace,
  renderers = [],
}: {
  request?: ArtifactViewerRequest;
  close: () => void;
  openWorkspace: (attachment: WorkspaceAttachment) => void;
  renderers?: ArtifactRenderer[];
}) => {
  if (!request) return null;
  if (isImage(request.attachment)) {
    return <ArtifactImageGallery request={request} close={close} openWorkspace={openWorkspace} />;
  }
  return <ArtifactDocumentViewer request={request} close={close} openWorkspace={openWorkspace} renderers={renderers} />;
};

const ArtifactDocumentViewer = ({
  request,
  close,
  openWorkspace,
  renderers,
}: {
  request: ArtifactViewerRequest;
  close: () => void;
  openWorkspace: (attachment: WorkspaceAttachment) => void;
  renderers: ArtifactRenderer[];
}) => {
  const dialogRef = useRef<HTMLElement>(null);
  const skipRestoreRef = useRef(false);
  const renderer = resolveArtifactRenderer(request.attachment, renderers);
  const Renderer = renderer.component;

  useModalLifecycle(dialogRef, close, request.opener, skipRestoreRef);

  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close();
  };
  const showWorkspace = () => {
    skipRestoreRef.current = true;
    openWorkspace(request.attachment);
  };

  return createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={closeOnBackdrop}>
      <section ref={dialogRef} className={styles.viewer} role="dialog" aria-modal="true" aria-labelledby="artifact-viewer-title">
        <header className={styles.toolbar}>
          <span className={styles.identity}>
            <File />
            <span>
              <strong id="artifact-viewer-title">{request.attachment.name}</strong>
              <small>{request.attachment.mime_type} · {formatBytes(request.attachment.size)}</small>
            </span>
          </span>
          <span className={styles.actions}>
            <button type="button" onClick={showWorkspace}><FolderOpen />Open in Workspace</button>
            <a href={request.attachment.url} download><Download />Download</a>
            <button className={styles.close} type="button" onClick={close} aria-label="Close artifact viewer"><X /></button>
          </span>
        </header>
        <main className={styles.content} data-renderer={renderer.id}>
          <Renderer attachment={request.attachment} />
        </main>
      </section>
    </div>,
    document.body,
  );
};

const ArtifactImageGallery = ({
  request,
  close,
  openWorkspace,
}: {
  request: ArtifactViewerRequest;
  close: () => void;
  openWorkspace: (attachment: WorkspaceAttachment) => void;
}) => {
  const images = useMemo(() => {
    const candidates = (request.gallery?.length ? request.gallery : [request.attachment]).filter(isImage);
    return candidates.some(item => item.version_id === request.attachment.version_id)
      ? candidates
      : [request.attachment, ...candidates];
  }, [request]);
  const initialIndex = Math.max(0, images.findIndex(item => item.version_id === request.attachment.version_id));
  const [index, setIndex] = useState(initialIndex);
  const skipRestoreRef = useRef(false);
  const current = images[index] ?? request.attachment;

  useEffect(() => () => {
    if (!skipRestoreRef.current && request.opener?.isConnected) request.opener.focus({ preventScroll: true });
  }, [request.opener]);

  const showWorkspace = () => {
    skipRestoreRef.current = true;
    openWorkspace(current);
  };

  return <Lightbox
    className={styles.lightbox}
    open
    close={close}
    index={index}
    slides={images.map(item => ({ src: item.preview_url, alt: item.name, title: item.name }))}
    plugins={[Captions, Counter, Zoom]}
    carousel={{ finite: true, imageFit: 'contain' }}
    controller={{ aria: true, closeOnBackdropClick: true }}
    captions={{ descriptionTextAlign: 'center', descriptionMaxLines: 2, showToggle: false }}
    counter={{ separator: ' of ' }}
    on={{ view: ({ index: next }) => setIndex(next) }}
    toolbar={{ buttons: [
      <button key="workspace" className={styles.lightboxAction} type="button" onClick={showWorkspace} aria-label="Open image in Workspace" title="Open in Workspace"><FolderOpen /></button>,
      <a key="download" className={styles.lightboxAction} href={current.url} download aria-label="Download image" title="Download"><Download /></a>,
      'close',
    ] }}
    labels={{
      Close: 'Close viewer',
      Next: 'Next image',
      Previous: 'Previous image',
      'Zoom in': 'Zoom in',
      'Zoom out': 'Zoom out',
    }}
  />;
};

export const ArtifactActionsMenu = ({
  attachment,
  openWorkspace,
  className = '',
}: {
  attachment: WorkspaceAttachment;
  openWorkspace: (attachment: WorkspaceAttachment) => void;
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

  return <span ref={rootRef} className={`${styles.menuRoot} ${className}`}>
    <button type="button" className={styles.menuTrigger} aria-label={`Actions for ${attachment.name}`} aria-expanded={open} onClick={event => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setPosition({ top: Math.min(rect.bottom + 4, innerHeight - 80), left: Math.max(8, rect.right - 170) });
      setOpen(value => !value);
    }}><MoreHorizontal /></button>
    {open && createPortal(<span ref={menuRef} className={`${styles.menu} ${styles.menuPortal}`} style={position} role="menu">
      <button type="button" role="menuitem" onClick={event => { event.stopPropagation(); setOpen(false); openWorkspace(attachment); }}><FolderOpen />Open in Workspace</button>
      <a role="menuitem" href={attachment.url} download onClick={event => { event.stopPropagation(); setOpen(false); }}><Download />Download</a>
    </span>,document.body)}
  </span>;
};

const HtmlArtifact = ({ attachment }: ArtifactRendererProps) =>
  <IsolatedHtmlPreview className={styles.frame} title={attachment.name} previewUrl={attachment.preview_url}/>;

const SvgArtifact = ({ attachment }: ArtifactRendererProps) =>
  <div className={styles.visual}><img src={attachment.preview_url} alt={attachment.name} /></div>;

const PdfArtifact = ({ attachment }: ArtifactRendererProps) =>
  <iframe className={styles.frame} title={attachment.name} src={attachment.preview_url} sandbox="" />;

const MarkdownArtifact = ({ attachment }: ArtifactRendererProps) =>
  <FetchedText attachment={attachment}>{text => <article className={styles.markdown}><Markdown remarkPlugins={[remarkGfm]} skipHtml>{text}</Markdown></article>}</FetchedText>;

const JsonArtifact = ({ attachment }: ArtifactRendererProps) =>
  <FetchedText attachment={attachment}>{text => {
    let value = text;
    try { value = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Preserve invalid JSON as captured. */ }
    return <pre className={styles.code}>{value}</pre>;
  }}</FetchedText>;

const TextArtifact = ({ attachment }: ArtifactRendererProps) =>
  <FetchedText attachment={attachment}>{text => <pre className={styles.text}>{text}</pre>}</FetchedText>;

const UnsupportedArtifact = ({ attachment }: ArtifactRendererProps) =>
  <div className={styles.unsupported}><File /><strong>Preview unavailable</strong><span>{attachment.mime_type}</span><small>{formatBytes(attachment.size)}</small><a href={attachment.url} download><Download />Download file</a></div>;

const builtInRenderers: ArtifactRenderer[] = [
  { id: 'markdown', matches: item => item.mime_type === 'text/markdown', component: MarkdownArtifact },
  { id: 'json', matches: item => item.mime_type === 'application/json', component: JsonArtifact },
  { id: 'html', matches: item => item.mime_type === 'text/html', component: HtmlArtifact },
  { id: 'svg', matches: item => item.mime_type === 'image/svg+xml', component: SvgArtifact },
  { id: 'pdf', matches: item => item.mime_type === 'application/pdf', component: PdfArtifact },
  { id: 'text', matches: item => item.mime_type.startsWith('text/'), component: TextArtifact },
  { id: 'fallback', matches: () => true, component: UnsupportedArtifact },
];

const FetchedText = ({
  attachment,
  children,
}: {
  attachment: WorkspaceAttachment;
  children: (text: string) => ReactNode;
}) => {
  const [state, setState] = useState<{ text?: string; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    setState({});
    fetch(attachment.preview_url, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Preview request failed: HTTP ${response.status}`);
        return response.text();
      })
      .then(text => setState({ text }))
      .catch(error => {
        if ((error as Error).name !== 'AbortError') setState({ error: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [attachment.preview_url]);
  if (state.error) return <div className={styles.unsupported}><File /><strong>Could not load preview</strong><span>{state.error}</span><a href={attachment.url} download><Download />Download file</a></div>;
  if (state.text === undefined) return <div className={styles.loading}>Loading preview…</div>;
  return children(state.text);
};

const useModalLifecycle = (
  dialogRef: React.RefObject<HTMLElement | null>,
  close: () => void,
  opener: HTMLElement | null | undefined,
  skipRestoreRef: React.RefObject<boolean>,
) => {
  useEffect(() => {
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],iframe,[tabindex]:not([tabindex="-1"])') ?? [])];
    requestAnimationFrame(() => focusable()[0]?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener('keydown', handleKey);
      if (!skipRestoreRef.current && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [close, dialogRef, opener, skipRestoreRef]);
};

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};
