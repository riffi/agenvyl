import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File, X } from 'lucide-react';
import type { RoomPlanState, RoomWorkspace, WorkspaceAttachment, WorkspaceEntry } from '@agenvyl/contracts';
import { Alert } from '../../shared/ui';
import { roomsApi } from '../../entities/room';
import { WorkspaceContent } from './WorkspaceContent';
import { WorkspaceExplorer } from './WorkspaceExplorer';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceOperationDialog, WorkspacePlanEditor, type WorkspaceOperation } from './WorkspaceDialogs';
import {
  defaultWorkspaceMode,
  workspaceAttachmentFromVersion,
  type WorkspaceEncoding,
  type WorkspaceOpenRequest,
  type WorkspaceRequestUpdate,
} from './workspaceModel';
import styles from './WorkspaceWindow.module.css';

export const WorkspaceWindow = ({
  request,
  roomId,
  fake = false,
  plan,
  planModeEnabled = true,
  onClose,
  onRequestChange,
  onAttach,
}: {
  request?: WorkspaceOpenRequest;
  roomId: string;
  fake?: boolean;
  plan?: RoomPlanState;
  planModeEnabled?: boolean;
  onClose: () => void;
  onRequestChange: (update: WorkspaceRequestUpdate) => void;
  onAttach?: (attachment: WorkspaceAttachment) => void;
}) => {
  const open = Boolean(request);
  const queryClient = useQueryClient();
  const workspaceKey = ['rooms', roomId, 'workspace'] as const;
  const [trash, setTrash] = useState(false);
  const [operation, setOperation] = useState<WorkspaceOperation>();
  const [uploadDirectory, setUploadDirectory] = useState('');
  const [editingPlan, setEditingPlan] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [explorerWidth, setExplorerWidth] = useState(() => clampWidth(Number(localStorage.getItem('workspace-explorer-width')) || 286));
  const previousCurrentRef = useRef<string | undefined>(undefined);

  const workspaceQuery = useQuery({
    queryKey: [...workspaceKey, trash ? 'trash' : 'active'],
    queryFn: ({ signal }) => trash ? fetchDeletedWorkspace(roomId, signal) : roomsApi.workspace(roomId, signal),
    enabled: open && !fake && Boolean(roomId),
    refetchInterval: open ? 5000 : false,
  });
  const entries = (workspaceQuery.data?.entries ?? []) as WorkspaceEntry[];
  const visibleEntries = useMemo(() => entries.filter(entry => trash ? Boolean(entry.deleted_at) : !entry.deleted_at), [entries, trash]);
  const target = request?.target;
  const selected = visibleEntries.find(entry => entry.id === target?.entryId && entry.kind === 'file');

  const versionsQuery = useQuery({
    queryKey: [...workspaceKey, 'versions', target?.entryId],
    queryFn: () => roomsApi.versions(roomId, target!.entryId!),
    enabled: open && !fake && Boolean(target?.entryId),
  });
  const versions = versionsQuery.data ?? [];
  const current = versions.find(version => version.id === selected?.current_version_id) ?? versions[0];
  const requestedVersion = versions.find(version => version.id === target?.versionId);
  const transientAttachment = request?.gallery?.find(item => item.version_id === target?.versionId);
  const metadataQuery = useQuery({
    queryKey: [...workspaceKey, 'version', target?.versionId],
    queryFn: ({ signal }) => roomsApi.version(roomId, target!.versionId!, signal),
    enabled: open && !fake && Boolean(target?.versionId) && !requestedVersion && !transientAttachment,
  });
  const viewed = requestedVersion ?? metadataQuery.data ?? (!target?.versionId ? current : undefined);
  const attachment = transientAttachment ?? (viewed ? workspaceAttachmentFromVersion(viewed) : undefined);
  const mode = attachment && request?.mode && ['rendered','source'].includes(request.mode)
    ? request.mode
    : attachment ? defaultWorkspaceMode(attachment) : 'rendered';
  const treeVisible = request?.treeVisible ?? request?.origin === 'workspace';

  const mutation = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setError(undefined);
      setOperation(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceKey }),
        target?.entryId ? queryClient.invalidateQueries({ queryKey: [...workspaceKey, 'versions', target.entryId] }) : Promise.resolve(),
      ]);
    },
    onError: value => setError(value instanceof Error ? value.message : String(value)),
  });

  useEffect(() => {
    if (!open) return;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (operation) {
        setOperation(undefined);
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      request?.opener?.isConnected && request.opener.focus({ preventScroll: true });
    };
  }, [onClose, open, operation, request?.opener]);

  useEffect(() => {
    if (!open || !target?.entryId || selected || workspaceQuery.isFetching || !workspaceQuery.isSuccess || trash) return;
    setTrash(true);
  }, [open, selected, target?.entryId, trash, workspaceQuery.isFetching, workspaceQuery.isSuccess]);

  useEffect(() => {
    if (!open || !selected?.current_version_id || target?.versionId) return;
    const draft = attachmentForEntry(roomId, selected);
    onRequestChange({ target: { entryId: selected.id, versionId: selected.current_version_id }, mode: defaultWorkspaceMode(draft), followCurrent: true });
  }, [attachment, onRequestChange, open, roomId, selected, target?.versionId]);

  useEffect(() => {
    const currentId = selected?.current_version_id;
    if (!open || !currentId) return;
    const prior = previousCurrentRef.current;
    previousCurrentRef.current = currentId;
    if (!prior || prior === currentId || !request?.followCurrent || target?.versionId === currentId) return;
    setNotice('A new current version was published.');
    onRequestChange({ target: { ...target, versionId: currentId }, followCurrent: true });
  }, [onRequestChange, open, request?.followCurrent, selected?.current_version_id, target]);

  useEffect(() => {
    setEditingPlan(false);
    setNotice(undefined);
  }, [target?.entryId]);

  if (!request) return null;

  const selectEntry = (entry: WorkspaceEntry) => {
    if (!entry.current_version_id) return;
    const nextAttachment = attachmentForEntry(roomId, entry);
    setUploadDirectory(parentPath(entry.path));
    setEditingPlan(false);
    onRequestChange({
      target: { entryId: entry.id, versionId: entry.current_version_id },
      mode: defaultWorkspaceMode(nextAttachment),
      followCurrent: true,
      gallery: undefined,
    });
  };

  const submitOperation = async (value?: string) => {
    if (!operation) return;
    if (operation.kind === 'create') {
      const path = uploadDirectory ? `${uploadDirectory}/${value}` : value!;
      await mutation.mutateAsync(() => roomsApi.createDirectory(roomId, path));
      return;
    }
    if (operation.kind === 'rename') {
      const directory = parentPath(operation.entry.path);
      await mutation.mutateAsync(() => roomsApi.moveEntry(roomId, operation.entry.id, directory ? `${directory}/${value}` : value!));
      return;
    }
    if (operation.kind === 'move') {
      await mutation.mutateAsync(() => roomsApi.moveEntry(roomId, operation.entry.id, value!));
      return;
    }
    await mutation.mutateAsync(() => roomsApi.deleteEntry(roomId, operation.entry.id));
  };

  const uploadFiles = async (files: File[]) => {
    for (const file of files.slice(0, 10)) {
      const filePath = uploadDirectory ? `${uploadDirectory}/${file.name}` : file.name;
      try {
        await roomsApi.uploadFile(roomId, file, filePath);
      } catch (value) {
        const failure = value as Error & { code?: string };
        if (failure.code === 'file_exists' && confirm(`${filePath} already exists. Save it as a new version?`)) {
          await roomsApi.uploadFile(roomId, file, filePath, 'replace');
        } else {
          setError(failure.message);
        }
      }
    }
    await queryClient.invalidateQueries({ queryKey: workspaceKey });
  };

  const startResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = explorerWidth;
    const move = (next: PointerEvent) => {
      const width = clampWidth(startWidth + next.clientX - startX);
      setExplorerWidth(width);
      localStorage.setItem('workspace-explorer-width', String(width));
    };
    const stop = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', stop);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', stop);
  };

  return createPortal(<section className={styles.window} role="dialog" aria-modal="true" aria-label="Workspace">
    <WorkspaceHeader
      treeVisible={treeVisible}
      entry={selected}
      attachment={attachment}
      versions={versions}
      current={current}
      viewed={viewed}
      mode={mode}
      approvedVersionId={planModeEnabled ? plan?.approved?.version_id : undefined}
      planModeEnabled={planModeEnabled}
      deleted={Boolean(selected?.deleted_at)}
      editingPlan={editingPlan}
      canAttach={Boolean(onAttach)}
      onTreeToggle={() => onRequestChange({ treeVisible: !treeVisible })}
      onVersion={(version, followCurrent) => onRequestChange({ target: { entryId: version.entry_id ?? target?.entryId, versionId: version.id }, followCurrent, mode })}
      onMode={nextMode => onRequestChange({ mode: nextMode })}
      onRestoreVersion={() => {
        if (!viewed || !confirm('Restore this version as a new current version?')) return;
        onRequestChange({ followCurrent: true });
        mutation.mutate(() => roomsApi.restoreVersion(roomId, viewed.id));
      }}
      onRestoreEntry={() => selected && mutation.mutate(() => roomsApi.restoreEntry(roomId, selected.id), { onSuccess: () => setTrash(false) })}
      onEditPlan={() => setEditingPlan(true)}
      onAttach={() => attachment && onAttach?.(attachment)}
      onRename={() => selected && setOperation({ kind: 'rename', entry: selected })}
      onMove={() => selected && setOperation({ kind: 'move', entry: selected })}
      onDelete={() => selected && setOperation({ kind: 'delete', entry: selected })}
      onRefresh={() => void workspaceQuery.refetch()}
      onClose={onClose}
    />
    {error && <div className={styles.alert}><Alert tone="error">{error}</Alert></div>}
    {workspaceQuery.error && <div className={styles.alert}><Alert tone="error">{workspaceQuery.error instanceof Error ? workspaceQuery.error.message : String(workspaceQuery.error)}</Alert></div>}
    {notice && <button className={styles.notice} onClick={() => setNotice(undefined)}>{notice}<X /></button>}
    <div className={styles.layout}>
      {treeVisible && <div className={styles.explorerShell} style={{ width: explorerWidth }}>
        <WorkspaceExplorer
          entries={visibleEntries}
          selectedId={selected?.id}
          trash={trash}
          loading={workspaceQuery.isPending}
          planModeEnabled={planModeEnabled}
          onFile={selectEntry}
          onDirectory={setUploadDirectory}
          onUpload={files => void uploadFiles(files)}
          onCreateFolder={() => setOperation({ kind: 'create' })}
          onRename={entry => setOperation({ kind: 'rename', entry })}
          onTrashToggle={() => setTrash(value => !value)}
        />
        <div className={styles.explorerResizer} onPointerDown={startResize} />
      </div>}
      <main className={styles.viewer}>
        {fake && !attachment
          ? <ViewerEmpty title="Workspace is unavailable in demo mode" detail="Open a captured artifact to preview it." />
          : attachment
            ? <>
              <div className={styles.content}>
                {editingPlan && current
                  ? <WorkspacePlanEditor version={current} cancel={() => setEditingPlan(false)} save={async content => {
                    await mutation.mutateAsync(() => roomsApi.updatePlan(roomId, content, current.id));
                    setEditingPlan(false);
                    onRequestChange({ followCurrent: true });
                  }} />
                  : <WorkspaceContent
                      attachment={attachment}
                      mode={mode}
                      encoding={request.encoding}
                      gallery={request.gallery}
                      onEncodingChange={(encoding?: WorkspaceEncoding) => onRequestChange({ encoding })}
                      onGalleryNavigate={item => onRequestChange({
                        target: { entryId: item.entry_id, versionId: item.version_id, snapshotId: item.snapshot_id, path: item.path },
                        mode: defaultWorkspaceMode(item),
                        followCurrent: false,
                      })}
                    />}
              </div>
            </>
            : <ViewerEmpty title={treeVisible ? 'Select a file' : 'No file selected'} detail={treeVisible ? 'Its contents will open here.' : 'Open the file tree to browse the workspace.'} />}
      </main>
    </div>
    {operation && <WorkspaceOperationDialog operation={operation} directory={uploadDirectory} pending={mutation.isPending} onClose={() => setOperation(undefined)} onSubmit={submitOperation} />}
  </section>, document.body);
};

const ViewerEmpty = ({ title, detail }: { title: string; detail: string }) =>
  <div className={styles.viewerEmpty}><File /><strong>{title}</strong><span>{detail}</span></div>;

const attachmentForEntry = (roomId: string, entry: WorkspaceEntry): WorkspaceAttachment => {
  const versionId = entry.current_version_id!;
  const base = `/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/versions/${encodeURIComponent(versionId)}`;
  return {
    version_id: versionId,
    entry_id: entry.id,
    name: entry.name,
    path: entry.path,
    size: entry.size,
    mime_type: entry.mime_type,
    url: base,
    preview_url: `${base}/preview`,
  };
};

const fetchDeletedWorkspace = async (roomId: string, signal?: AbortSignal): Promise<RoomWorkspace> => {
  const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace?deleted=true`, { signal });
  if (!response.ok) throw new Error(`Failed to load trash: HTTP ${response.status}`);
  return response.json() as Promise<RoomWorkspace>;
};

const parentPath = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const clampWidth = (value: number) => Math.max(220, Math.min(460, value));
