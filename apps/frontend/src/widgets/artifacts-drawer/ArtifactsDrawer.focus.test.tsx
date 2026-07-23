// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roomsApi } from '../../entities/room';
import { ArtifactsDrawer } from './ArtifactsDrawer';

vi.mock('../../entities/room', () => ({
  roomsApi: {
    workspace: vi.fn(),
    versions: vi.fn(),
  },
}));

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ArtifactsDrawer focus', () => {
  it('falls back to the trash when a historical attachment entry was deleted later', async () => {
    vi.mocked(roomsApi.workspace).mockResolvedValue({ path: '', current_snapshot_id:'snapshot-1', materialization_status:'ready', entries: [] });
    vi.mocked(roomsApi.versions).mockResolvedValue([{
      id: 'version-deleted',
      entry_id: 'entry-deleted',
      path: 'archive/deleted.md',
      size: 12,
      mime_type: 'text/markdown',
      sha256: 'hash',
      created_at: '2026-07-23T00:00:00.000Z',
      source: 'agent',
      run_ids: ['run-1'],
      url: '/deleted',
      preview_url: '/deleted/preview',
    }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      path: '',
      entries: [{
        id: 'entry-deleted',
        path: 'archive/deleted.md',
        name: 'deleted.md',
        kind: 'file',
        size: 12,
        mime_type: 'text/markdown',
        updated_at: '2026-07-23T00:00:00.000Z',
        current_version_id: 'version-deleted',
        deleted_at: '2026-07-23T01:00:00.000Z',
        status: 'tracked',
      }],
    }), { headers: { 'content-type': 'application/json' } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(<QueryClientProvider client={client}>
      <ArtifactsDrawer open close={vi.fn()} roomId="room-1" focus={{ entryId: 'entry-deleted', versionId: 'version-deleted', requestId: 1 }} />
    </QueryClientProvider>);

    await waitFor(() => expect(screen.getAllByText('deleted.md').length).toBeGreaterThan(0));
    expect(screen.queryByText('Select a deleted file')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe('true');
  });
});
