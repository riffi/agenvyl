// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAttachment, WorkspaceEntry, WorkspaceVersion } from '@agenvyl/contracts';
import { roomsApi } from '../../entities/room';
import { WorkspaceWindow } from './WorkspaceWindow';

const entry: WorkspaceEntry = {
  id: 'entry-page',
  path: 'site/page.html',
  name: 'page.html',
  kind: 'file',
  size: 24,
  mime_type: 'text/html',
  updated_at: '2026-07-23T10:00:00.000Z',
  current_version_id: 'version-2',
  deleted_at: null,
  status: 'tracked',
};

const version = (id: string, created_at: string): WorkspaceVersion => ({
  id,
  entry_id: entry.id,
  path: entry.path,
  size: entry.size,
  mime_type: entry.mime_type,
  sha256: id,
  source: 'agent',
  run_ids: [],
  created_at,
  url: `/versions/${id}`,
  preview_url: `/versions/${id}/preview`,
});

const attachment = (value: WorkspaceVersion): WorkspaceAttachment => ({
  version_id: value.id,
  entry_id: value.entry_id,
  path: value.path,
  name: 'page.html',
  size: value.size,
  mime_type: value.mime_type,
  url: value.url,
  preview_url: value.preview_url,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WorkspaceWindow', () => {
  it('opens an exact artifact with a single compact header and contextual actions', async () => {
    const latest = version('version-2', '2026-07-23T10:00:00.000Z');
    const older = version('version-1', '2026-07-22T10:00:00.000Z');
    vi.spyOn(roomsApi, 'workspace').mockResolvedValue({ path: '/room', current_snapshot_id: 'snapshot', materialization_status: 'ready', entries: [entry] });
    vi.spyOn(roomsApi, 'versions').mockResolvedValue([latest, older]);
    const onRequestChange = vi.fn();
    const onClose = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WorkspaceWindow
      request={{
        origin: 'artifact',
        target: { entryId: entry.id, versionId: latest.id },
        treeVisible: false,
        gallery: [attachment(latest)],
      }}
      roomId="room"
      onClose={onClose}
      onRequestChange={onRequestChange}
    /></QueryClientProvider>);

    expect(screen.queryByRole('navigation', { name: 'Workspace files' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show workspace files' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Version 2 of 2' })).toBeTruthy());
    expect(screen.getByText('page.html')).toBeTruthy();
    const sourceAction = screen.getByRole('button', { name: 'Source' });
    expect(sourceAction.closest('details')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View older version' }));
    expect(onRequestChange).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({ versionId: older.id }),
      followCurrent: false,
    }));
    const versionPicker = screen.getByRole('button', { name: 'Version 2 of 2' });
    fireEvent.click(versionPicker);
    expect((versionPicker.closest('details') as HTMLDetailsElement).open).toBe(true);
    const actions = screen.getByRole('button', { name: 'Workspace actions' });
    fireEvent.click(actions);
    expect((actions.closest('details') as HTMLDetailsElement).open).toBe(true);
    const closeButton = screen.getByRole('button', { name: 'Close workspace' });
    expect(closeButton.closest('details')).toBeNull();
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(sourceAction);
    expect(onRequestChange).toHaveBeenCalledWith({ mode: 'source' });
  });

  it('opens the file tree by default for a workspace entry point', async () => {
    vi.spyOn(roomsApi, 'workspace').mockResolvedValue({ path: '/room', current_snapshot_id: 'snapshot', materialization_status: 'ready', entries: [entry] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WorkspaceWindow
      request={{ origin: 'workspace', treeVisible: true }}
      roomId="room"
      onClose={vi.fn()}
      onRequestChange={vi.fn()}
    /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText('site')).toBeTruthy());
    expect(screen.getByRole('navigation', { name: 'Workspace files' })).toBeTruthy();
  });

  it('switches from the full-width mobile tree to the file viewer after selection', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    vi.spyOn(roomsApi, 'workspace').mockResolvedValue({ path: '/room', current_snapshot_id: 'snapshot', materialization_status: 'ready', entries: [entry] });
    const onRequestChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WorkspaceWindow
      request={{ origin: 'workspace', treeVisible: true }}
      roomId="room"
      onClose={vi.fn()}
      onRequestChange={onRequestChange}
    /></QueryClientProvider>);

    fireEvent.click(await screen.findByText('site'));
    fireEvent.click(screen.getByText('page.html'));
    expect(onRequestChange).toHaveBeenLastCalledWith(expect.objectContaining({
      target: { entryId: entry.id, versionId: entry.current_version_id },
      treeVisible: false,
    }));
  });

  it('shows a targeted file instead of the full-width tree on mobile', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const latest = version('version-2', '2026-07-23T10:00:00.000Z');
    vi.spyOn(roomsApi, 'workspace').mockResolvedValue({ path: '/room', current_snapshot_id: 'snapshot', materialization_status: 'ready', entries: [entry] });
    vi.spyOn(roomsApi, 'versions').mockResolvedValue([latest]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WorkspaceWindow
      request={{
        origin: 'workspace',
        target: { entryId: entry.id, versionId: latest.id },
        treeVisible: false,
      }}
      roomId="room"
      onClose={vi.fn()}
      onRequestChange={vi.fn()}
    /></QueryClientProvider>);

    expect(screen.queryByRole('navigation', { name: 'Workspace files' })).toBeNull();
    expect(await screen.findByText('page.html')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show workspace files' })).toBeTruthy();
  });
});
