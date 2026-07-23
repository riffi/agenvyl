import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FolderOpen, Image as ImageIcon, ImageOff } from 'lucide-react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Lightbox from 'yet-another-react-lightbox';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';
import 'yet-another-react-lightbox/plugins/counter.css';
import type { RunEmbedError, WorkspaceAttachment } from '@agenvyl/contracts';
import type { Persona } from '../../entities/persona';
import type { Run } from '../../entities/run';
import styles from './MarkdownAnswer.module.css';
import { MentionLink, remarkPersonaMentions } from './mentions';

const terminalStatuses = new Set<Run['status']>(['completed', 'failed', 'cancelled']);
const lightboxPlugins = [Captions, Counter, Zoom];

type MarkdownAnswerProps = {
  text: string;
  run: Run;
  personas?: Persona[];
  onMentionPersona?: (handle: string) => void;
  openWorkspace?: (attachment: WorkspaceAttachment) => void;
};

export const MarkdownAnswer = memo(({
  text,
  run,
  personas = [],
  onMentionPersona,
  openWorkspace,
}: MarkdownAnswerProps) => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const openerPathRef = useRef<string | null>(null);
  const skipRestoreRef = useRef(false);
  const galleryImages = useMemo(
    () => (run.embeds ?? []).flatMap(embed => embed.status === 'resolved' && embed.attachment
      ? [{ path: embed.path, attachment: embed.attachment }]
      : []),
    [run.embeds],
  );
  const slides = useMemo(
    () => galleryImages.map(({ attachment }) => ({
      src: attachment.preview_url,
      alt: attachment.name,
      title: attachment.name,
    })),
    [galleryImages],
  );

  const openGallery = (path: string, trigger: HTMLButtonElement) => {
    const index = galleryImages.findIndex(image => image.path === path);
    if (index < 0) return;
    openerPathRef.current = path;
    openerRef.current = trigger;
    setOpenIndex(index);
  };

  const closeGallery = () => {
    skipRestoreRef.current = false;
    setOpenIndex(null);
  };
  const showWorkspace = () => {
    const attachment = galleryImages[openIndex ?? -1]?.attachment;
    if (!attachment || !openWorkspace) return;
    skipRestoreRef.current = true;
    setOpenIndex(null);
    openWorkspace(attachment);
  };

  useEffect(() => {
    if (openIndex !== null || !openerRef.current || skipRestoreRef.current) {
      skipRestoreRef.current = false;
      return;
    }
    let timeout: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const restore = () => {
      const opener = openerRef.current;
      if (!opener?.isConnected) return;
      if (opener.closest('[inert]') && attempts < 50) {
        attempts += 1;
        timeout = setTimeout(restore, 20);
        return;
      }
      opener.focus({ preventScroll: true });
    };
    timeout = setTimeout(restore, 0);
    return () => clearTimeout(timeout);
  }, [openIndex]);

  return <>
    <Markdown
      remarkPlugins={[remarkGfm, [remarkPersonaMentions, { handles: personas.map(persona => persona.handle) }]]}
      skipHtml
      urlTransform={(url, key, node) => url.startsWith('mention:') && key === 'href' && node.tagName === 'a'
        || url.startsWith('workspace:') && key === 'src' && node.tagName === 'img'
        ? url
        : defaultUrlTransform(url)}
      components={{
        p: ({ node, children, ...props }) => {
          const child = node?.children.length === 1 ? node.children[0] : undefined;
          if (child?.type === 'element' && child.tagName === 'img') return <>{children}</>;
          return <p {...props}>{children}</p>;
        },
        a: ({ node: _node, href, ...props }) => {
          if (!href?.startsWith('mention:')) return <a {...props} href={href} target="_blank" rel="noopener noreferrer" />;
          let handle = href.slice('mention:'.length);
          try {
            handle = decodeURIComponent(handle);
          } catch {
            return <>{props.children}</>;
          }
          return <MentionLink handle={handle} personas={personas} onMentionPersona={onMentionPersona} />;
        },
        img: ({ node: _node, src, alt }) => {
          if (!src?.startsWith('workspace:')) return <EmbedError title="Image is not stored in the workspace" detail={alt?.trim() || 'External images are not published directly'} />;

          const raw = src.slice('workspace:'.length);
          let imagePath = raw;
          try {
            imagePath = decodeURIComponent(raw);
          } catch {
            // The backend reports invalid paths after the run finishes.
          }
          const embed = run.embeds?.find(item => item.path === imagePath || item.path === raw);

          if (!terminalStatuses.has(run.status)) return <span className={styles.placeholder}><ImageIcon/><span>The image will appear when the response is complete<small>{imagePath}</small></span></span>;
          if (embed?.status !== 'resolved' || !embed.attachment) {
            const reason = run.status !== 'completed' ? 'response did not complete' : embedError(embed?.error);
            return <EmbedError title="Could not display image" detail={`${imagePath} · ${reason}`} />;
          }

          const caption = alt?.trim() || embed.attachment.name;
          return <figure className={styles.figure}>
            <button
              ref={node => {
                if (node && openerPathRef.current === embed.path) openerRef.current = node;
              }}
              className={styles.stage}
              type="button"
              onClick={event => openGallery(embed.path, event.currentTarget)}
              aria-label={`Open image “${caption}” in full-screen view`}
              title={`Open ${embed.attachment.name}`}
            >
              <img className={styles.image} src={embed.attachment.preview_url} alt={caption} loading="lazy" />
            </button>
            <figcaption>{caption}</figcaption>
          </figure>;
        },
      }}
    >
      {text}
    </Markdown>
    <Lightbox
      className={styles.lightbox}
      open={openIndex !== null}
      close={closeGallery}
      index={openIndex ?? 0}
      slides={slides}
      plugins={lightboxPlugins}
      carousel={{ finite: true, imageFit: 'contain' }}
      controller={{ aria: true, closeOnBackdropClick: true }}
      captions={{ descriptionTextAlign: 'center', descriptionMaxLines: 2, showToggle: false }}
      counter={{ separator: ' of ' }}
      toolbar={{ buttons: [
        ...(openWorkspace ? [<button key="workspace" className={styles.lightboxAction} type="button" onClick={showWorkspace} aria-label="Open image in Workspace" title="Open in Workspace"><FolderOpen /></button>] : []),
        galleryImages[openIndex ?? -1]?.attachment
          ? <a key="download" className={styles.lightboxAction} href={galleryImages[openIndex ?? 0].attachment.url} download aria-label="Download image" title="Download"><Download /></a>
          : null,
        'close',
      ] }}
      labels={{
        Close: 'Close viewer',
        Next: 'Next image',
        Previous: 'Previous image',
        'Zoom in': 'Zoom in',
        'Zoom out': 'Zoom out',
      }}
    />
  </>;
});

MarkdownAnswer.displayName = 'MarkdownAnswer';

const EmbedError = ({ title, detail }: { title: string; detail: string }) => <span className={styles.error}>
  <ImageOff />
  <span><strong>{title}</strong><small>{detail}</small></span>
</span>;

const embedError = (error?: RunEmbedError) => {
  switch (error) {
    case 'invalid_path': return 'invalid path';
    case 'not_found': return 'file not found';
    case 'unsupported_type': return 'unsupported format';
    case 'invalid_content': return 'content is not a valid image';
    case 'limit_exceeded': return 'the 10-image limit was exceeded';
    default: return 'attachment was not captured';
  }
};
