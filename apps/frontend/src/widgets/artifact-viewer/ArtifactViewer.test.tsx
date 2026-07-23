// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAttachment } from '@agenvyl/contracts';
import { ArtifactViewer, resolveArtifactRenderer, type ArtifactViewerRequest } from './ArtifactViewer';
import {RuntimeFeaturesProvider} from '../../shared/features';

const attachment = (mime_type: string, name = 'artifact.md'): WorkspaceAttachment => ({
  version_id: `version-${name}`,
  entry_id: `entry-${name}`,
  path: `results/${name}`,
  name,
  size: 8287,
  mime_type,
  url: `/api/files/${name}`,
  preview_url: `/api/files/${name}/preview`,
});

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ArtifactViewer', () => {
  it('renders the captured Markdown version and opens that exact version in Workspace', async () => {
    const synopsis = {
      ...attachment('text/markdown', 'prvaya-popytka-synopsis.md'),
      version_id: 'cd3b6ab9-149b-42b2-9f75-89a17b11f45d',
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Первая попытка\n\nСинопсис повести.')));
    const openWorkspace = vi.fn();
    render(<ArtifactViewer request={{ attachment: synopsis }} close={vi.fn()} openWorkspace={openWorkspace} />);

    expect(await screen.findByRole('heading', { name: 'Первая попытка' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Workspace' }));
    expect(openWorkspace).toHaveBeenCalledWith(synopsis);
    expect(document.querySelector('[target="_blank"]')).toBeNull();
  });

  it('uses isolated renderers for HTML, SVG and PDF', () => {
    const { rerender } = render(<RuntimeFeaturesProvider value={{plan_mode:false,preview_origin:'http://preview.test:8792'}}><ArtifactViewer request={{ attachment: attachment('text/html', 'demo.html') }} close={vi.fn()} openWorkspace={vi.fn()} /></RuntimeFeaturesProvider>);
    expect(screen.getByTitle('demo.html').getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(screen.getByTitle('demo.html').getAttribute('src')).toBe('http://preview.test:8792/api/files/demo.html/preview');

    rerender(<RuntimeFeaturesProvider value={{plan_mode:false,preview_origin:'http://preview.test:8792'}}><ArtifactViewer request={{ attachment: attachment('image/svg+xml', 'diagram.svg') }} close={vi.fn()} openWorkspace={vi.fn()} /></RuntimeFeaturesProvider>);
    expect(screen.getByAltText('diagram.svg').getAttribute('src')).toContain('/preview');

    rerender(<RuntimeFeaturesProvider value={{plan_mode:false,preview_origin:'http://preview.test:8792'}}><ArtifactViewer request={{ attachment: attachment('application/pdf', 'brief.pdf') }} close={vi.fn()} openWorkspace={vi.fn()} /></RuntimeFeaturesProvider>);
    expect(screen.getByTitle('brief.pdf').getAttribute('sandbox')).toBe('');
  });

  it('shows a download fallback for unsupported MIME types', () => {
    const archive = attachment('application/zip', 'bundle.zip');
    render(<ArtifactViewer request={{ attachment: archive }} close={vi.fn()} openWorkspace={vi.fn()} />);
    expect(screen.getByText('Preview unavailable')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download file' }).getAttribute('href')).toBe(archive.url);
  });

  it('allows future diagram renderers to register ahead of built-ins', () => {
    const diagram = attachment('application/vnd.agenvyl.diagram+json', 'chart.diagram');
    const renderer = resolveArtifactRenderer(diagram, [{ id: 'diagram', matches: item => item.mime_type.includes('diagram'), component: () => null }]);
    expect(renderer.id).toBe('diagram');
  });

  it('closes on Escape and restores focus to the opening card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Document')));
    const opener = document.createElement('button');
    opener.textContent = 'Open artifact';
    document.body.append(opener);
    opener.focus();
    const request: ArtifactViewerRequest = { attachment: attachment('text/plain', 'notes.txt'), opener };

    const Harness = () => {
      const [current, setCurrent] = useState<ArtifactViewerRequest | undefined>(request);
      return <ArtifactViewer request={current} close={() => setCurrent(undefined)} openWorkspace={vi.fn()} />;
    };
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
