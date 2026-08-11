// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAttachment } from '@agenvyl/contracts';
import { ImageLightbox } from './ImageLightbox';

const lightbox = vi.hoisted(() => vi.fn(() => null));

vi.mock('yet-another-react-lightbox', () => ({ default: lightbox }));

afterEach(() => {
  cleanup();
  lightbox.mockClear();
});

const attachment: WorkspaceAttachment = {
  version_id: 'version-image',
  entry_id: 'entry-image',
  path: 'images/wide.png',
  name: 'wide.png',
  size: 10,
  mime_type: 'image/png',
  url: '/versions/image',
  preview_url: '/versions/image/preview',
};

describe('ImageLightbox', () => {
  it('allows images at their natural size to zoom both in and out', () => {
    render(<ImageLightbox attachments={[attachment]} index={0} onIndexChange={vi.fn()} onClose={vi.fn()} />);

    expect(lightbox).toHaveBeenCalledWith(expect.objectContaining({
      zoom: {
        minZoom: 0.25,
        maxZoomPixelRatio: 4,
        zoomInMultiplier: 1.5,
        wheelZoomDistanceFactor: 1000,
        scrollToZoom: true,
      },
    }), undefined);
  });
});
