import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronRight,
  Download,
  File,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  GitCompare,
  History,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { RoomWorkspace, WorkspaceAttachment, WorkspaceEntry, WorkspaceVersion } from '@agenvyl/contracts';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Alert, Button, Dialog, IconButton, Input } from '../../shared/ui';
import { roomsApi } from '../../entities/room';
import { buildWorkspaceTree, filterWorkspaceTree, treeDirectoryPaths, type WorkspaceTreeNode } from './workspaceTree';
import styles from './ArtifactsDrawer.module.css';

type Operation =
  | { kind: 'create' }
  | { kind: 'rename'; entry: WorkspaceEntry }
  | { kind: 'move'; entry: WorkspaceEntry }
  | { kind: 'delete'; entry: WorkspaceEntry };

export function ArtifactsDrawer({ open, close, roomId, fake = false, onAttach }: {
  open: boolean;
  close: () => void;
  roomId: string;
  fake?: boolean;
  onAttach?: (attachment: WorkspaceAttachment) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const key = ['rooms', roomId, 'workspace'] as const;
  const compact = useCompactWorkspace();
  const [selectedId, setSelectedId] = useState<string>();
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string>();
  const [trash, setTrash] = useState(false);
  const [compare, setCompare] = useState<WorkspaceVersion>();
  const [tab, setTab] = useState<'preview' | 'versions'>('preview');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [uploadDirectory, setUploadDirectory] = useState('');
  const [mobileStep, setMobileStep] = useState<'explorer' | 'viewer'>('explorer');
  const [createMenu, setCreateMenu] = useState(false);
  const [fileMenu, setFileMenu] = useState(false);
  const [operation, setOperation] = useState<Operation>();
  const [panelWidth, setPanelWidth] = useState(() => clampStoredWidth(Number(localStorage.getItem('workspace-panel-width')) || 680));

  const query = useQuery({
    queryKey: [...key, trash ? 'trash' : 'active'],
    queryFn: ({ signal }) => trash ? fetchDeletedWorkspace(roomId, signal) : roomsApi.workspace(roomId, signal),
    enabled: open && !fake && Boolean(roomId),
    refetchInterval: open ? 5000 : false,
  });
  const entries = (query.data?.entries ?? []) as WorkspaceEntry[];
  const visibleEntries = useMemo(() => entries.filter(entry => trash ? Boolean(entry.deleted_at) : !entry.deleted_at), [entries, trash]);
  const selected = visibleEntries.find(entry => entry.id === selectedId && entry.kind === 'file');
  const tree = useMemo(() => buildWorkspaceTree(visibleEntries), [visibleEntries]);
  const filteredTree = useMemo(() => filterWorkspaceTree(tree, search), [tree, search]);
  const searchExpanded = useMemo(() => new Set(treeDirectoryPaths(filteredTree)), [filteredTree]);
  const effectiveExpanded = search ? new Set([...expanded, ...searchExpanded]) : expanded;

  const versions = useQuery({
    queryKey: [...key, 'versions', selected?.id],
    queryFn: () => roomsApi.versions(roomId, selected!.id),
    enabled: Boolean(selected?.current_version_id),
  });
  const current = versions.data?.find(version => version.id === selected?.current_version_id) ?? versions.data?.[0];
  const mutate = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setError(undefined);
      setOperation(undefined);
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: value => setError(value instanceof Error ? value.message : String(value)),
  });

  useEffect(() => {
    if (selectedId && !visibleEntries.some(entry => entry.id === selectedId)) {
      setSelectedId(undefined);
      setMobileStep('explorer');
    }
    setCompare(undefined);
  }, [visibleEntries, selectedId]);
  useEffect(() => {
    if (!open) return;
    setCreateMenu(false);
    setFileMenu(false);
    if (compact && !selectedId) setMobileStep('explorer');
  }, [open, compact, selectedId]);
  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!createMenuRef.current?.contains(target)) setCreateMenu(false);
      if (!fileMenuRef.current?.contains(target)) setFileMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (createMenu || fileMenu) event.stopImmediatePropagation();
        setCreateMenu(false);
        setFileMenu(false);
      }
    };
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', closeMenus);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [createMenu, fileMenu]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });
  const uploadFiles = async (files: FileList | File[]) => {
    for (const file of [...files].slice(0, 10)) {
      const filePath = uploadDirectory ? `${uploadDirectory}/${file.name}` : file.name;
      try {
        await roomsApi.uploadFile(roomId, file, filePath);
      } catch (value) {
        const failure = value as Error & { code?: string };
        if (failure.code === 'file_exists' && confirm(`${filePath} уже существует. Сохранить как новую версию?`)) {
          await roomsApi.uploadFile(roomId, file, filePath, 'replace');
        } else throw value;
      }
    }
    await invalidate();
  };
  const selectFile = (entry: WorkspaceEntry) => {
    setSelectedId(entry.id);
    setUploadDirectory(parentPath(entry.path));
    setTab('preview');
    setCompare(undefined);
    if (compact) setMobileStep('viewer');
  };
  const toggleFolder = (path: string) => {
    setUploadDirectory(path);
    setExpanded(currentExpanded => {
      const next = new Set(currentExpanded);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };
  const attach = () => {
    if (current && onAttach) onAttach(toAttachment(current));
  };
  const startResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => {
      const available = Math.max(320, innerWidth - (innerWidth >= 768 ? 280 : 0));
      const width = Math.max(Math.min(560, available), Math.min(900, available, innerWidth - next.clientX));
      setPanelWidth(width);
      localStorage.setItem('workspace-panel-width', String(width));
    };
    const stop = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', stop);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', stop);
  };
  const submitOperation = async (value?: string) => {
    if (!operation) return;
    if (operation.kind === 'create') {
      const path = uploadDirectory ? `${uploadDirectory}/${value}` : value!;
      await mutate.mutateAsync(() => roomsApi.createDirectory(roomId, path));
    }
    if (operation.kind === 'rename') {
      const destination = parentPath(operation.entry.path);
      await mutate.mutateAsync(() => roomsApi.moveEntry(roomId, operation.entry.id, destination ? `${destination}/${value}` : value!));
    }
    if (operation.kind === 'move') await mutate.mutateAsync(() => roomsApi.moveEntry(roomId, operation.entry.id, value!));
    if (operation.kind === 'delete') await mutate.mutateAsync(() => roomsApi.deleteEntry(roomId, operation.entry.id));
  };

  return <aside className={`${styles.panel} ${open ? styles.open : ''}`} style={{ width: panelWidth }} aria-hidden={!open} ui-spec-block-id="artifacts_and_patches">
    <div className={styles.resizer} onPointerDown={startResize} />
    <header className={styles.panelHeader}>
      <FolderOpen />
      <strong>Workspace</strong>
      <IconButton aria-label="Обновить workspace" title="Обновить" onClick={() => void query.refetch()}><RefreshCw /></IconButton>
      <IconButton aria-label="Закрыть workspace" title="Закрыть" onClick={close}><X /></IconButton>
    </header>
    {fake ? <div className={styles.panelMessage}><Alert>В demo-режиме workspace недоступен.</Alert></div> : <>
      {error && <div className={styles.alert}><Alert tone="error">{error}</Alert></div>}
      {query.error && <div className={styles.alert}><Alert tone="error">{query.error instanceof Error ? query.error.message : String(query.error)}</Alert></div>}
      <div className={`${styles.content} ${compact ? styles.compact : ''}`}>
        {(!compact || mobileStep === 'explorer') && <aside className={styles.explorer}>
          <div className={styles.explorerToolbar}>
            <label className={styles.search}><Search /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={trash ? 'Поиск в корзине' : 'Поиск файлов'} /></label>
            {!trash && <div className={styles.menuAnchor} ref={createMenuRef}>
              <IconButton aria-label="Добавить в workspace" title="Добавить" className={styles.addButton} onClick={() => setCreateMenu(value => !value)}><Plus /></IconButton>
              {createMenu && <div className={`${styles.menu} ${styles.createMenu}`} role="menu">
                <button role="menuitem" onClick={() => inputRef.current?.click()}><Upload />Загрузить файлы</button>
                <button role="menuitem" onClick={() => { setCreateMenu(false); setOperation({ kind: 'create' }); }}><FolderPlus />Создать папку</button>
              </div>}
            </div>}
          </div>
          <input ref={inputRef} hidden type="file" multiple onChange={event => {
            if (event.target.files) void uploadFiles(event.target.files).catch(value => setError(value instanceof Error ? value.message : String(value)));
            event.currentTarget.value = '';
          }} />
          <nav className={styles.tree} aria-label={trash ? 'Корзина workspace' : 'Файлы workspace'} onDragOver={event => event.preventDefault()} onDrop={event => {
            if (trash) return;
            event.preventDefault();
            if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files).catch(value => setError(String(value)));
          }}>
            {query.isPending && <ExplorerMessage>Загружаем workspace…</ExplorerMessage>}
            {!query.isPending && !filteredTree.length && <ExplorerMessage icon={<FilePlus2 />}>{search ? 'Ничего не найдено' : trash ? 'Корзина пуста' : 'Workspace пуст'}</ExplorerMessage>}
            {filteredTree.map(node => <TreeRow key={node.path} node={node} depth={0} expanded={effectiveExpanded} selectedId={selectedId} activeDirectory={uploadDirectory} trash={trash} onFolder={toggleFolder} onFile={selectFile} onRename={entry => setOperation({ kind: 'rename', entry })} />)}
          </nav>
          <button className={`${styles.trashToggle} ${trash ? styles.trashActive : ''}`} onClick={() => {
            setTrash(value => !value);
            setSelectedId(undefined);
            setSearch('');
            setMobileStep('explorer');
          }}><Trash2 />{trash ? 'Вернуться к файлам' : 'Корзина'}</button>
        </aside>}
        {(!compact || mobileStep === 'viewer') && <main className={styles.viewer}>
          {selected ? <>
            <header className={styles.fileHeader}>
              {compact && <IconButton className={styles.backButton} aria-label="Назад к файлам" onClick={() => setMobileStep('explorer')}><ArrowLeft /></IconButton>}
              <File />
              <div className={styles.fileIdentity}><strong title={selected.name}>{selected.name}</strong><small title={selected.path}>{selected.path} <span>· {formatBytes(selected.size)}</span></small></div>
              <div className={styles.fileActions}>
                {selected.deleted_at ? <Button size="sm" variant="primary" icon={<RotateCcw />} onClick={() => mutate.mutate(() => roomsApi.restoreEntry(roomId, selected.id))}>Восстановить</Button> : <>
                  {onAttach && current && <Button className={styles.attachButton} size="sm" variant="primary" icon={<Paperclip />} onClick={attach}><span>Прикрепить</span></Button>}
                  {current && <a className={styles.iconLink} href={current.url} aria-label="Скачать файл" title="Скачать"><Download /></a>}
                  <div className={styles.menuAnchor} ref={fileMenuRef}>
                    <IconButton aria-label="Действия с файлом" title="Действия" onClick={() => setFileMenu(value => !value)}><MoreHorizontal /></IconButton>
                    {fileMenu && <div className={`${styles.menu} ${styles.fileMenu}`} role="menu">
                      <button role="menuitem" onClick={() => { setFileMenu(false); setOperation({ kind: 'rename', entry: selected }); }}>Переименовать</button>
                      <button role="menuitem" onClick={() => { setFileMenu(false); setOperation({ kind: 'move', entry: selected }); }}>Переместить</button>
                      <button role="menuitem" className={styles.dangerItem} onClick={() => { setFileMenu(false); setOperation({ kind: 'delete', entry: selected }); }}><Trash2 />Удалить</button>
                    </div>}
                  </div>
                </>}
              </div>
            </header>
            <div className={styles.tabs} role="tablist">
              <button role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? styles.activeTab : ''} onClick={() => setTab('preview')}>Просмотр</button>
              <button role="tab" aria-selected={tab === 'versions'} className={tab === 'versions' ? styles.activeTab : ''} onClick={() => setTab('versions')}><History />Версии{versions.data ? <em>{versions.data.length}</em> : null}</button>
            </div>
            {tab === 'preview' ? <FilePreview selected={selected} current={current} /> : <VersionHistory versions={versions.data ?? []} selected={selected} current={current} compare={compare} setCompare={setCompare} restore={version => mutate.mutate(() => roomsApi.restoreVersion(roomId, version.id))} />}
          </> : <div className={styles.viewerEmpty}><File /><strong>{trash ? 'Выберите удалённый файл' : 'Выберите файл'}</strong><span>{trash ? 'Его можно просмотреть и восстановить.' : 'Содержимое откроется здесь.'}</span></div>}
        </main>}
      </div>
    </>}
    {operation && <OperationDialog operation={operation} directory={uploadDirectory} pending={mutate.isPending} onClose={() => setOperation(undefined)} onSubmit={submitOperation} />}
  </aside>;
}

function TreeRow({ node, depth, expanded, selectedId, activeDirectory, trash, onFolder, onFile, onRename }: {
  node: WorkspaceTreeNode;
  depth: number;
  expanded: Set<string>;
  selectedId?: string;
  activeDirectory: string;
  trash: boolean;
  onFolder: (path: string) => void;
  onFile: (entry: WorkspaceEntry) => void;
  onRename: (entry: WorkspaceEntry) => void;
}) {
  const open = expanded.has(node.path);
  const entry = node.entry;
  return <div role="treeitem" aria-expanded={node.kind === 'directory' ? open : undefined}>
    <button
      className={`${styles.treeRow} ${entry?.id === selectedId ? styles.selected : ''} ${node.kind === 'directory' && node.path === activeDirectory ? styles.activeDirectory : ''}`}
      style={{ paddingLeft: 7 + depth * 14 }}
      title={node.path}
      onClick={() => node.kind === 'directory' ? onFolder(node.path) : entry && onFile(entry)}
      onDoubleClick={() => !trash && entry && onRename(entry)}
    >
      {node.kind === 'directory' ? <ChevronRight className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} /> : <span className={styles.chevronSpace} />}
      {node.kind === 'directory' ? open ? <FolderOpen /> : <Folder /> : <File />}
      <span>{node.name}</span>
      {entry?.status === 'oversize' && <em>oversize</em>}
    </button>
    {node.kind === 'directory' && open && node.children.map(child => <TreeRow key={child.path} node={child} depth={depth + 1} expanded={expanded} selectedId={selectedId} activeDirectory={activeDirectory} trash={trash} onFolder={onFolder} onFile={onFile} onRename={onRename} />)}
  </div>;
}

function ExplorerMessage({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return <div className={styles.explorerMessage}>{icon}<span>{children}</span></div>;
}

function FilePreview({ selected, current }: { selected: WorkspaceEntry; current?: WorkspaceVersion }) {
  if (!current) return <div className={styles.previewFallback}><File /><span>Preview пока недоступен</span></div>;
  if (selected.mime_type === 'text/html') return <div className={styles.preview}><iframe title={selected.name} src={current.preview_url} sandbox="allow-scripts" /></div>;
  if (selected.mime_type === 'text/markdown') return <div className={styles.preview}><MarkdownPreview url={current.preview_url} /></div>;
  if (selected.mime_type.startsWith('image/')) return <div className={`${styles.preview} ${styles.imagePreview}`}><img src={current.preview_url} alt={selected.name} /></div>;
  if (selected.mime_type.startsWith('text/') || selected.mime_type === 'application/json') return <div className={styles.preview}><iframe title={selected.name} src={current.preview_url} sandbox="" /></div>;
  return <div className={styles.previewFallback}><File /><strong>Preview недоступен</strong><span>{selected.mime_type}</span></div>;
}

function VersionHistory({ versions, selected, current, compare, setCompare, restore }: {
  versions: WorkspaceVersion[];
  selected: WorkspaceEntry;
  current?: WorkspaceVersion;
  compare?: WorkspaceVersion;
  setCompare: (version?: WorkspaceVersion) => void;
  restore: (version: WorkspaceVersion) => void;
}) {
  return <div className={styles.history}>
    {!versions.length && <div className={styles.viewerEmpty}><History /><strong>Версий пока нет</strong></div>}
    {versions.map((version, index) => <div className={styles.versionRow} key={version.id}>
      <span><strong>{version.id === current?.id ? 'Текущая версия' : `Версия ${versions.length - index}`}</strong><small>{new Date(version.created_at).toLocaleString()} · {version.source}{version.run_ids.length ? ` · ${version.run_ids.length} run` : ''}</small></span>
      {version.id !== current?.id && <div>
        {selected.mime_type.startsWith('text/') && <IconButton aria-label="Сравнить версию" title="Сравнить" onClick={() => setCompare(version)}><GitCompare /></IconButton>}
        <IconButton aria-label="Восстановить версию" title="Восстановить" onClick={() => restore(version)}><RotateCcw /></IconButton>
      </div>}
    </div>)}
    {compare && current && <TextDiff before={compare.preview_url} after={current.preview_url} close={() => setCompare(undefined)} />}
  </div>;
}

function OperationDialog({ operation, directory, pending, onClose, onSubmit }: {
  operation: Operation;
  directory: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (value?: string) => Promise<void>;
}) {
  const initial = operation.kind === 'create' ? '' : operation.kind === 'rename' ? operation.entry.name : operation.kind === 'move' ? operation.entry.path : '';
  const [value, setValue] = useState(initial);
  const [validation, setValidation] = useState<string>();
  const title = operation.kind === 'create' ? 'Создать папку' : operation.kind === 'rename' ? 'Переименовать файл' : operation.kind === 'move' ? 'Переместить файл' : 'Удалить файл';
  const description = operation.kind === 'delete' ? `«${operation.entry.path}» будет перемещён в корзину.` : operation.kind === 'rename' ? `Текущий путь: ${operation.entry.path}` : operation.kind === 'move' ? 'Укажите новый полный путь вместе с именем файла.' : `Папка будет создана в ${directory || 'корне workspace'}.`;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim().replace(/^\/+|\/+$/g, '');
    if (operation.kind !== 'delete' && !next) return setValidation('Введите непустое значение.');
    if ((operation.kind === 'create' || operation.kind === 'rename') && next.includes('/')) return setValidation('Имя не должно содержать «/».');
    if (operation.kind === 'rename' && next === operation.entry.name) return setValidation('Имя не изменилось.');
    if (operation.kind === 'move' && next === operation.entry.path) return setValidation('Путь не изменился.');
    setValidation(undefined);
    try {
      await onSubmit(operation.kind === 'delete' ? undefined : next);
    } catch {
      // Mutation errors are shown in the drawer alert and the dialog stays open.
    }
  };
  return <Dialog open title={title} description={description} onClose={onClose} footer={<>
    <Button variant="secondary" disabled={pending} onClick={onClose}>Отмена</Button>
    <Button variant={operation.kind === 'delete' ? 'danger' : 'primary'} disabled={pending} type="submit" form="workspace-operation">{pending ? 'Сохраняем…' : operation.kind === 'delete' ? 'Переместить в корзину' : 'Сохранить'}</Button>
  </>}>
    <form id="workspace-operation" className={styles.operationForm} onSubmit={submit}>
      {operation.kind !== 'delete' && <label><span>{operation.kind === 'move' ? 'Новый путь' : operation.kind === 'rename' ? 'Новое имя' : 'Имя папки'}</span><Input autoFocus value={value} onChange={event => { setValue(event.target.value); setValidation(undefined); }} aria-invalid={Boolean(validation)} /></label>}
      {validation && <small className={styles.validation}>{validation}</small>}
    </form>
  </Dialog>;
}

function MarkdownPreview({ url }: { url: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then(response => response.text()).then(setText).catch(() => {});
    return () => controller.abort();
  }, [url]);
  return <article className={styles.markdown}><Markdown remarkPlugins={[remarkGfm]} skipHtml>{text}</Markdown></article>;
}

function TextDiff({ before, after, close }: { before: string; after: string; close: () => void }) {
  const [values, setValues] = useState<[string, string]>(['', '']);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetch(before, { signal: controller.signal }).then(response => response.text()), fetch(after, { signal: controller.signal }).then(response => response.text())]).then(value => setValues(value as [string, string])).catch(() => {});
    return () => controller.abort();
  }, [before, after]);
  const left = values[0].split('\n'), right = values[1].split('\n'), length = Math.max(left.length, right.length);
  return <section className={styles.diff}><header><strong>Изменения относительно выбранной версии</strong><IconButton aria-label="Закрыть сравнение" onClick={close}><X /></IconButton></header><pre>{Array.from({ length }, (_, index) => left[index] === right[index] ? `  ${right[index] ?? ''}` : `- ${left[index] ?? ''}\n+ ${right[index] ?? ''}`).join('\n')}</pre></section>;
}

function useCompactWorkspace() {
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 899px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width: 899px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

async function fetchDeletedWorkspace(roomId: string, signal?: AbortSignal): Promise<RoomWorkspace> {
  const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace?deleted=true`, { signal });
  if (!response.ok) throw new Error(`Не удалось загрузить корзину: HTTP ${response.status}`);
  return response.json() as Promise<RoomWorkspace>;
}

function toAttachment(version: WorkspaceVersion): WorkspaceAttachment {
  return { version_id: version.id, entry_id: version.entry_id, path: version.path, name: version.path.split('/').pop() ?? version.path, size: version.size, mime_type: version.mime_type, url: version.url, preview_url: version.preview_url };
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

function parentPath(path: string) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function clampStoredWidth(value: number) {
  return Math.max(560, Math.min(900, value));
}
