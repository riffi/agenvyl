// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ISOLATED_PREVIEW_SANDBOX, RuntimeFeaturesProvider } from '../../shared/features';
import { FullscreenPreviewPage } from './FullscreenPreviewPage';

afterEach(cleanup);

describe('FullscreenPreviewPage', () => {
  it('renders the route-selected build inside the isolated preview sandbox', () => {
    render(
      <RuntimeFeaturesProvider value={{ preview_origin: 'http://127.0.0.1:8792' }}>
        <MemoryRouter initialEntries={['/rooms/room%20one/runs/run%2B1/fullscreen-preview?previewUrl=https://unsafe.example/']}>
          <Routes>
            <Route path="/rooms/:roomId/runs/:runId/fullscreen-preview" element={<FullscreenPreviewPage />} />
          </Routes>
        </MemoryRouter>
      </RuntimeFeaturesProvider>,
    );

    const preview = screen.getByTitle('Full-screen app preview');
    expect(preview.getAttribute('src')).toBe('http://127.0.0.1:8792/api/v1/rooms/room%20one/runs/run%2B1/preview/');
    expect(preview.getAttribute('sandbox')).toBe(ISOLATED_PREVIEW_SANDBOX);
  });
});
