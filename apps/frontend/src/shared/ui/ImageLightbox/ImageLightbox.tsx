import type { ReactNode } from 'react';
import { Download } from 'lucide-react';
import type { WorkspaceAttachment } from '@agenvyl/contracts';
import Lightbox from 'yet-another-react-lightbox';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';
import 'yet-another-react-lightbox/plugins/counter.css';
import styles from './ImageLightbox.module.css';

const plugins = [Captions, Counter, Zoom];

export type ImageLightboxAction = {
  key: string;
  label: string;
  title: string;
  icon: ReactNode;
  onSelect: (attachment: WorkspaceAttachment, index: number) => void;
};

export const ImageLightbox = ({
  attachments,
  index,
  actions = [],
  onIndexChange,
  onClose,
}: {
  attachments: WorkspaceAttachment[];
  index: number | null;
  actions?: ImageLightboxAction[];
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) => {
  const activeIndex = index ?? 0;
  const active = attachments[activeIndex];
  const slides = attachments.map(attachment => ({
    src: attachment.preview_url,
    alt: attachment.name,
    title: attachment.name,
  }));

  return <Lightbox
    className={styles.lightbox}
    open={index !== null}
    close={onClose}
    index={activeIndex}
    slides={slides}
    plugins={plugins}
    carousel={{ finite: true, imageFit: 'contain' }}
    controller={{ aria: true, closeOnBackdropClick: true }}
    captions={{ descriptionTextAlign: 'center', descriptionMaxLines: 2, showToggle: false }}
    counter={{ separator: ' of ' }}
    on={{ view: ({ index: next }) => onIndexChange(next) }}
    toolbar={{ buttons: [
      ...actions.map(action => <button key={action.key} className={styles.action} type="button" onClick={() => active && action.onSelect(active, activeIndex)} aria-label={action.label} title={action.title}>{action.icon}</button>),
      active ? <a key="download" className={styles.action} href={active.url} download aria-label="Download image" title="Download image"><Download /></a> : null,
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
