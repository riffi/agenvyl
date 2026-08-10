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
  it('keeps the workspace open when Escape closes an image lightbox', () => {
    const onClose = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WorkspaceWindow
      request={{ origin: 'workspace', treeVisible: false }}
      roomId="room"
      fake
      onClose={onClose}
      onRequestChange={vi.fn()}
    /></QueryClientProvider>);
    const lightbox = document.createElement('div');
    lightbox.className = 'yarl__root';
    document.body.append(lightbox);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    lightbox.remove();
  });

  it('opens an exact artifact with a single compact header and contextual actions', async () => {
    const latest = version('version-2', '2026-07-23T10:00:00.000Z');
    const older = version('version-1', '2026-07-22T10:00:00.000Z');
    vi.spyOn(roomsApi, 'workspace').mockResolvedValue({ path: '/room', head: 'snapshot', entries: [entry], previewHistory: [] });
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
    expect(screen.getByRole('button', { name: 'Version 2 of 2' }).textContent).toBe('v2/2');
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
    vi.spyOn(roomsApi, 'workspace').mockResolvedValue({ path: '/room', head: 'snapshot', entries: [entry], previewHistory: [] });
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

  it('opens the current app build by default when it matches the workspace', async () => {
    const preview: WorkspaceAttachment = {
      version_id: 'build-version',
      path: 'dist/index.html',
      name: 'index.html',
      size: 42,
      mime_type: 'text/html',
      url: '/versions/build-version',
      preview_url: '/api/v1/rooms/room/runs/run-1/preview/',
    };
    vi.spyOn(roomsApi, 'workspace').mockResolvedValue({
      path: '/room',
      head: 'snapshot',
      entries: [entry],
      staticPreview: { status: 'ready', runId: 'run-1', attachment: preview },
      previewHistory: [{ runId: 'run-1', sourceHead: 'run-snapshot', agent: 'builder', createdAt: '2026-07-23T10:00:00.000Z', runStatus: 'completed', sameBuildAsPrevious: false, attachment: preview }],
    });
    const onRequestChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WorkspaceWindow
      request={{ origin: 'workspace', treeVisible: true }}
      roomId="room"
      onClose={vi.fn()}
      onRequestChange={onRequestChange}
    /></QueryClientProvider>);

    const appPreview = await screen.findByRole('button', { name: 'App preview' });
    await waitFor(() => expect(appPreview.getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Choose app build' }).getAttribute('title')).toContain('@builder');
    expect(onRequestChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect(onRequestChange).toHaveBeenLastCalledWith({
      section: 'files',
      treeVisible: true,
      target: undefined,
      gallery: undefined,
      mode: undefined,
      encoding: undefined,
      followCurrent: false,
    });
  });

  it('explains when the room preview no longer matches current sources', async () => {
    vi.spyOn(roomsApi, 'workspace').mockResolvedValue({
      path: '/room',
      head: 'snapshot',
      entries: [entry],
      staticPreview: { status: 'outdated', runId: 'run-1' },
      previewHistory: [{ runId: 'run-1', sourceHead: 'run-snapshot', agent: 'builder', createdAt: '2026-07-23T10:00:00.000Z', runStatus: 'completed', sameBuildAsPrevious: false, attachment: { version_id: 'build-version', path: 'dist/index.html', name: 'index.html', size: 42, mime_type: 'text/html', url: '/versions/build-version', preview_url: '/api/v1/rooms/room/runs/run-1/preview/' } }],
    });
    const onRequestChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><WorkspaceWindow
      request={{ origin: 'workspace', treeVisible: true }}
      roomId="room"
      onClose={vi.fn()}
      onRequestChange={onRequestChange}
    /></QueryClientProvider>);

    const files = await screen.findByRole('button', { name: 'Files' });
    expect(files.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'App preview' }));
    expect(onRequestChange).toHaveBeenLastCalledWith({ section: 'app', treeVisible: false });

    view.rerender(<QueryClientProvider client={client}><WorkspaceWindow
      request={{ origin: 'workspace', section: 'app', treeVisible: false }}
      roomId="room"
      onClose={vi.fn()}
      onRequestChange={onRequestChange}
    /></QueryClientProvider>);
    expect(await screen.findByText('App preview is out of date')).toBeTruthy();
    expect(screen.getByText('Source files changed after this build.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open latest build anyway' }));
    expect(onRequestChange).toHaveBeenLastCalledWith({ section: 'app', buildRunId: 'run-1' });
  });

  it('switches from the full-width mobile tree to the file viewer after selection', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    vi.spyOn(roomsApi, 'workspace').mockResolvedValue({ path: '/room', head: 'snapshot', entries: [entry], previewHistory: [] });
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
    vi.spyOn(roomsApi, 'workspace').mockResolvedValue({ path: '/room', head: 'snapshot', entries: [entry], previewHistory: [] });
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

  it('labels historical and duplicate builds without changing the current file tree', async () => {
    const buildAttachment = (runId: string): WorkspaceAttachment => ({ version_id: `version-${runId}`, path: 'dist/index.html', name: 'index.html', size: 42, mime_type: 'text/html', url: `/versions/${runId}`, preview_url: `/api/v1/rooms/room/runs/${runId}/preview/` });
    const currentBuild = buildAttachment('run-2'),olderBuild = buildAttachment('run-1');
    vi.spyOn(roomsApi, 'workspace').mockResolvedValue({
      path: '/room', head: 'snapshot', entries: [entry],
      staticPreview: { status: 'ready', runId: 'run-2', attachment: currentBuild },
      previewHistory: [
        { runId: 'run-2', sourceHead: 'snapshot-run-2', agent: 'builder', createdAt: '2026-07-24T10:00:00.000Z', runStatus: 'failed', sameBuildAsPrevious: true, attachment: currentBuild },
        { runId: 'run-1', sourceHead: 'snapshot-run-1', agent: 'builder', createdAt: '2026-07-23T10:00:00.000Z', runStatus: 'completed', sameBuildAsPrevious: false, attachment: olderBuild },
      ],
    });
    const onRequestChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WorkspaceWindow
      request={{ origin: 'artifact', section: 'app', buildRunId: 'run-1', treeVisible: false }}
      roomId="room"
      onClose={vi.fn()}
      onRequestChange={onRequestChange}
    /></QueryClientProvider>);

    expect(await screen.findByText('Historical')).toBeTruthy();
    expect(screen.queryByText('App build')).toBeNull();
    expect(screen.queryByText('Historical build')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose app build' }));
    expect(screen.getByText('Same build as previous')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to current build' }));
    expect(onRequestChange).toHaveBeenLastCalledWith({ section: 'app', buildRunId: undefined });
  });

  it('opens a built app entry as source and explains how to launch its preview', async () => {
    const appEntry: WorkspaceEntry = { ...entry, id: 'entry-index', path: 'index.html', name: 'index.html', current_version_id: 'version-index' };
    const packageEntry: WorkspaceEntry = { ...entry, id: 'entry-package', path: 'package.json', name: 'package.json', mime_type: 'application/json', current_version_id: 'version-package' };
    const appVersion: WorkspaceVersion = { ...version('version-index', '2026-07-23T10:00:00.000Z'), entry_id: appEntry.id, path: appEntry.path, mime_type: appEntry.mime_type };
    vi.spyOn(roomsApi, 'workspace').mockResolvedValue({ path: '/room', head: 'snapshot', entries: [appEntry, packageEntry], previewHistory: [] });
    vi.spyOn(roomsApi, 'versions').mockResolvedValue([appVersion]);
    const onRequestChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WorkspaceWindow
      request={{ origin: 'workspace', target: { entryId: appEntry.id, versionId: appVersion.id }, mode: 'rendered', treeVisible: false }}
      roomId="room"
      onClose={vi.fn()}
      onRequestChange={onRequestChange}
    /></QueryClientProvider>);

    expect(await screen.findByText('App entry file')).toBeTruthy();
    expect(screen.getByText('This HTML starts the source app and needs its build pipeline to render correctly.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rendered' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open app preview' }));
    expect(onRequestChange).toHaveBeenLastCalledWith({ section: 'app', buildRunId: undefined, treeVisible: false });
  });
});
