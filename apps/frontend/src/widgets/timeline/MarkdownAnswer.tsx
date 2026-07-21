import { memo, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, ImageOff } from 'lucide-react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Lightbox from 'yet-another-react-lightbox';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';
import 'yet-another-react-lightbox/plugins/counter.css';
import type { RunEmbedError } from '@agenvyl/contracts';
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
};

export const MarkdownAnswer = memo(({
  text,
  run,
  personas = [],
  onMentionPersona,
}: MarkdownAnswerProps) => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
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
    openerRef.current = trigger;
    setOpenIndex(index);
  };

  const closeGallery = () => {
    setOpenIndex(null);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      openerRef.current?.focus({ preventScroll: true });
    }));
  };

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
          if (!src?.startsWith('workspace:')) return <EmbedError title="Изображение не сохранено в workspace" detail={alt?.trim() || 'Внешние изображения не публикуются напрямую'} />;

          const raw = src.slice('workspace:'.length);
          let imagePath = raw;
          try {
            imagePath = decodeURIComponent(raw);
          } catch {
            // The backend reports invalid paths after the run finishes.
          }
          const embed = run.embeds?.find(item => item.path === imagePath || item.path === raw);

          if (!terminalStatuses.has(run.status)) return <span className={styles.placeholder}><ImageIcon/><span>Изображение появится после завершения ответа<small>{imagePath}</small></span></span>;
          if (embed?.status !== 'resolved' || !embed.attachment) {
            const reason = run.status !== 'completed' ? 'ответ не завершён' : embedError(embed?.error);
            return <EmbedError title="Не удалось показать изображение" detail={`${imagePath} · ${reason}`} />;
          }

          const caption = alt?.trim() || embed.attachment.name;
          return <figure className={styles.figure}>
            <button
              className={styles.stage}
              type="button"
              onClick={event => openGallery(embed.path, event.currentTarget)}
              aria-label={`Открыть изображение «${caption}» в полноэкранном просмотре`}
              title={`Открыть ${embed.attachment.name}`}
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
      counter={{ separator: ' из ' }}
      labels={{
        Close: 'Закрыть просмотр',
        Next: 'Следующее изображение',
        Previous: 'Предыдущее изображение',
        'Zoom in': 'Увеличить',
        'Zoom out': 'Уменьшить',
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
    case 'invalid_path': return 'некорректный путь';
    case 'not_found': return 'файл не найден';
    case 'unsupported_type': return 'формат не поддерживается';
    case 'invalid_content': return 'содержимое не является валидным изображением';
    case 'limit_exceeded': return 'превышен лимит 10 изображений';
    default: return 'вложение не зафиксировано';
  }
};
