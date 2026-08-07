import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Expand, File, Play } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkspaceAttachment } from '@agenvyl/contracts';
import { IsolatedHtmlPreview } from '../../shared/features';
import { ImageLightbox } from '../../shared/ui';
import type { WorkspaceEncoding, WorkspaceViewMode } from './workspaceModel';
import { decodeWorkspaceBytes, SOURCE_PREVIEW_LIMIT } from './workspaceText';
import { isTextWorkspaceItem, workspaceModesFor } from './workspaceModel';
import { SourceViewer, useWorkspaceBytes } from './SourceViewer';
import styles from './WorkspaceContent.module.css';

export type WorkspaceRendererDefinition = {
  id: 'html' | 'markdown' | 'svg' | 'image' | 'pdf' | 'source' | 'unsupported';
  matches: (attachment: WorkspaceAttachment) => boolean;
  modes: WorkspaceViewMode[];
  textModel: boolean;
};

export const workspaceRenderers: WorkspaceRendererDefinition[] = [
  { id: 'html', matches: item => item.mime_type === 'text/html' || /\.html?$/i.test(item.path), modes: ['rendered','source'], textModel: true },
  { id: 'markdown', matches: item => item.mime_type === 'text/markdown' || /\.(md|markdown)$/i.test(item.path), modes: ['rendered','source'], textModel: true },
  { id: 'svg', matches: item => item.mime_type === 'image/svg+xml' || /\.svg$/i.test(item.path), modes: ['rendered','source'], textModel: true },
  { id: 'image', matches: item => item.mime_type.startsWith('image/'), modes: ['rendered'], textModel: false },
  { id: 'pdf', matches: item => item.mime_type === 'application/pdf' || /\.pdf$/i.test(item.path), modes: ['rendered'], textModel: false },
  { id: 'source', matches: isTextWorkspaceItem, modes: ['source'], textModel: true },
  { id: 'unsupported', matches: () => true, modes: ['rendered'], textModel: false },
];

export const resolveWorkspaceRenderer = (attachment: WorkspaceAttachment) =>
  workspaceRenderers.find(renderer => renderer.matches(attachment))!;

export const WorkspaceContent = ({
  attachment,
  mode,
  encoding,
  gallery,
  onEncodingChange,
  onGalleryNavigate,
  appEntry = false,
  onOpenAppPreview,
}: {
  attachment: WorkspaceAttachment;
  mode: WorkspaceViewMode;
  encoding?: WorkspaceEncoding;
  gallery?: WorkspaceAttachment[];
  onEncodingChange?: (encoding?: WorkspaceEncoding) => void;
  onGalleryNavigate?: (attachment: WorkspaceAttachment) => void;
  appEntry?: boolean;
  onOpenAppPreview?: () => void;
}) => {
  const renderer = resolveWorkspaceRenderer(attachment);
  const effectiveMode = workspaceModesFor(attachment).includes(mode) ? mode : renderer.modes[0];
  if (effectiveMode === 'source') return appEntry
    ? <div className={styles.appEntryContent}>
      <div className={styles.appEntryNotice} role="note"><span><strong>App entry file</strong><small>This HTML starts the source app and needs its build pipeline to render correctly.</small></span><button type="button" onClick={onOpenAppPreview}><Play aria-hidden="true"/>Open app preview</button></div>
      <SourceViewer attachment={attachment} encoding={encoding} onEncodingChange={onEncodingChange} />
    </div>
    : <SourceViewer attachment={attachment} encoding={encoding} onEncodingChange={onEncodingChange} />;
  if (renderer.id === 'html') return <IsolatedHtmlPreview className={styles.frame} title={attachment.name} previewUrl={attachment.preview_url} />;
  if (renderer.id === 'markdown') return <RenderedMarkdown attachment={attachment} encoding={encoding} />;
  if (renderer.id === 'svg') return <ImageGallery attachment={attachment} />;
  if (renderer.id === 'image') return <ImageGallery attachment={attachment} gallery={gallery} onNavigate={onGalleryNavigate} />;
  if (renderer.id === 'pdf') return <iframe className={styles.frame} title={attachment.name} src={attachment.preview_url} sandbox="" />;
  return <div className={styles.unsupported}><File /><strong>Preview unavailable</strong><span>{attachment.mime_type}</span><a href={attachment.url} download><Download />Download file</a></div>;
};

const RenderedMarkdown = ({ attachment, encoding }: { attachment: WorkspaceAttachment; encoding?: WorkspaceEncoding }) => {
  const state = useWorkspaceBytes(attachment.url);
  const text = useMemo(() => {
    if (!state.bytes || state.bytes.byteLength > SOURCE_PREVIEW_LIMIT) return undefined;
    return decodeWorkspaceBytes(state.bytes, encoding).text;
  }, [encoding, state.bytes]);
  if (state.error) return <div className={styles.unsupported}><File /><strong>Could not load Markdown</strong><span>{state.error}</span></div>;
  if (text === undefined) return <div className={styles.sourceLoading}>Loading document…</div>;
  return <div className={styles.documentCanvas}><article className={styles.markdown}><Markdown remarkPlugins={[remarkGfm]} skipHtml>{text}</Markdown></article></div>;
};

const ImageGallery = ({
  attachment,
  gallery,
  onNavigate,
}: {
  attachment: WorkspaceAttachment;
  gallery?: WorkspaceAttachment[];
  onNavigate?: (attachment: WorkspaceAttachment) => void;
}) => {
  const images = (gallery?.length ? gallery : [attachment]).filter(item => item.mime_type.startsWith('image/'));
  const index = Math.max(0, images.findIndex(item => item.version_id === attachment.version_id));
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const navigate = (offset: number) => onNavigate?.(images[index + offset]);
  const openLightbox = () => {
    restoreFocusRef.current = true;
    setOpenIndex(index);
  };
  const closeLightbox = () => {
    setOpenIndex(null);
  };
  useEffect(() => {
    if (openIndex !== null || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    const timeout = setTimeout(() => openerRef.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(timeout);
  }, [openIndex]);
  return <div className={styles.imageCanvas}>
    {index > 0 && <button className={`${styles.galleryArrow} ${styles.galleryPrevious}`} onClick={() => navigate(-1)} aria-label="Previous image"><ChevronLeft /></button>}
    <button ref={openerRef} className={styles.imageStage} type="button" onClick={openLightbox} aria-label={`Open image “${attachment.name}” in full-screen view`} title="Open full-screen viewer">
      <img src={attachment.preview_url} alt={attachment.name} />
      <span className={styles.imageInspect}><Expand />Inspect</span>
    </button>
    {index < images.length - 1 && <button className={`${styles.galleryArrow} ${styles.galleryNext}`} onClick={() => navigate(1)} aria-label="Next image"><ChevronRight /></button>}
    {images.length > 1 && <span className={styles.galleryCounter}>Image {index + 1} of {images.length}</span>}
    <ImageLightbox attachments={images} index={openIndex} onIndexChange={setOpenIndex} onClose={closeLightbox} />
  </div>;
};
