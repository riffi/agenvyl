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
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { RoomPlanState, RoomWorkspace, WorkspaceAttachment, WorkspaceEntry, WorkspaceVersion } from '@agenvyl/contracts';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Alert, Button, Dialog, IconButton, Input } from '../../shared/ui';
import {IsolatedHtmlPreview} from '../../shared/features';
import { roomsApi } from '../../entities/room';
import { buildWorkspaceTree, filterWorkspaceTree, treeDirectoryPaths, type WorkspaceTreeNode } from './workspaceTree';
import styles from './ArtifactsDrawer.module.css';

type Operation =
  | { kind: 'create' }
  | { kind: 'rename'; entry: WorkspaceEntry }
  | { kind: 'move'; entry: WorkspaceEntry }
  | { kind: 'delete'; entry: WorkspaceEntry };

export type WorkspaceFocus={entryId?:string;versionId?:string;requestId:number};

export function ArtifactsDrawer({ open, close, roomId, fake = false, onAttach,focus,plan,planModeEnabled=true }: {
  open: boolean;
  close: () => void;
  roomId: string;
  fake?: boolean;
  onAttach?: (attachment: WorkspaceAttachment) => void;
  focus?:WorkspaceFocus;
  plan?:RoomPlanState;
  planModeEnabled?:boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const appliedFocusRef=useRef<number|undefined>(undefined);
  const preparedFocusRef=useRef<number|undefined>(undefined);
  const activeFocusSearchRef=useRef<number|undefined>(undefined);
  const queryClient = useQueryClient();
  const key = ['rooms', roomId, 'workspace'] as const;
  const compact = useCompactWorkspace();
  const [selectedId, setSelectedId] = useState<string>();
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string>();
  const [trash, setTrash] = useState(false);
  const [compare, setCompare] = useState<WorkspaceVersion>();
  const [tab, setTab] = useState<'preview' | 'versions'>('preview');
  const [viewVersionId,setViewVersionId]=useState<string>();
  const [editingPlan,setEditingPlan]=useState(false);
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
  const viewed=versions.data?.find(version=>version.id===viewVersionId)??current;
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
    setEditingPlan(false);
  }, [visibleEntries, selectedId]);
  useEffect(()=>{if(!open||!focus||preparedFocusRef.current===focus.requestId)return;preparedFocusRef.current=focus.requestId;activeFocusSearchRef.current=undefined;setTrash(false);setSearch('');setSelectedId(undefined);setMobileStep('explorer');},[open,focus?.requestId]);
  useEffect(()=>{
    if(!open||!focus||appliedFocusRef.current===focus.requestId||query.isFetching||!query.isSuccess)return;
    if(trash&&activeFocusSearchRef.current!==focus.requestId)return;
    if(!trash)activeFocusSearchRef.current=focus.requestId;
    const entry=visibleEntries.find(item=>item.id===focus.entryId);
    if(entry){appliedFocusRef.current=focus.requestId;selectFile(entry);setViewVersionId(focus.versionId);setMobileStep('viewer');return;}
    if(!trash){setTrash(true);return;}
    appliedFocusRef.current=focus.requestId;
    setError('The referenced workspace file is no longer available.');
  },[open,focus?.requestId,visibleEntries,trash,query.isFetching,query.isSuccess]);
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
        if (failure.code === 'file_exists' && confirm(`${filePath} already exists. Save it as a new version?`)) {
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
    setViewVersionId(entry.current_version_id);
    setEditingPlan(false);
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
      <IconButton aria-label="Refresh workspace" title="Refresh" onClick={() => void query.refetch()}><RefreshCw /></IconButton>
      <IconButton aria-label="Close workspace" title="Close" onClick={close}><X /></IconButton>
    </header>
    {fake ? <div className={styles.panelMessage}><Alert>Workspace is unavailable in demo mode.</Alert></div> : <>
      {error && <div className={styles.alert}><Alert tone="error">{error}</Alert></div>}
      {query.error && <div className={styles.alert}><Alert tone="error">{query.error instanceof Error ? query.error.message : String(query.error)}</Alert></div>}
      <div className={`${styles.content} ${compact ? styles.compact : ''}`}>
        {(!compact || mobileStep === 'explorer') && <aside className={styles.explorer}>
          <div className={styles.explorerToolbar}>
            <label className={styles.search}><Search /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={trash ? 'Search trash' : 'Search files'} /></label>
            {!trash && <div className={styles.menuAnchor} ref={createMenuRef}>
              <IconButton aria-label="Add to workspace" title="Add" className={styles.addButton} onClick={() => setCreateMenu(value => !value)}><Plus /></IconButton>
              {createMenu && <div className={`${styles.menu} ${styles.createMenu}`} role="menu">
                <button role="menuitem" onClick={() => inputRef.current?.click()}><Upload />Upload files</button>
                <button role="menuitem" onClick={() => { setCreateMenu(false); setOperation({ kind: 'create' }); }}><FolderPlus />Create folder</button>
              </div>}
            </div>}
          </div>
          <input ref={inputRef} hidden type="file" multiple onChange={event => {
            if (event.target.files) void uploadFiles(event.target.files).catch(value => setError(value instanceof Error ? value.message : String(value)));
            event.currentTarget.value = '';
          }} />
          <nav className={styles.tree} aria-label={trash ? 'Workspace trash' : 'Workspace files'} onDragOver={event => event.preventDefault()} onDrop={event => {
            if (trash) return;
            event.preventDefault();
            if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files).catch(value => setError(String(value)));
          }}>
            {query.isPending && <ExplorerMessage>Loading workspace…</ExplorerMessage>}
            {!query.isPending && !filteredTree.length && <ExplorerMessage icon={<FilePlus2 />}>{search ? 'No results' : trash ? 'Trash is empty' : 'Workspace is empty'}</ExplorerMessage>}
            {filteredTree.map(node => <TreeRow key={node.path} node={node} depth={0} expanded={effectiveExpanded} selectedId={selectedId} activeDirectory={uploadDirectory} trash={trash} planModeEnabled={planModeEnabled} onFolder={toggleFolder} onFile={selectFile} onRename={entry => setOperation({ kind: 'rename', entry })} />)}
          </nav>
          <button className={`${styles.trashToggle} ${trash ? styles.trashActive : ''}`} onClick={() => {
            setTrash(value => !value);
            setSelectedId(undefined);
            setSearch('');
            setMobileStep('explorer');
          }}><Trash2 />{trash ? 'Back to files' : 'Trash'}</button>
        </aside>}
        {(!compact || mobileStep === 'viewer') && <main className={styles.viewer}>
          {selected ? <>
            <header className={styles.fileHeader}>
              {compact && <IconButton className={styles.backButton} aria-label="Back to files" onClick={() => setMobileStep('explorer')}><ArrowLeft /></IconButton>}
              <File />
              <div className={styles.fileIdentity}><strong title={selected.name}>{selected.name}</strong><small title={selected.path}>{selected.path} <span>· {formatBytes(selected.size)}</span></small></div>
              <div className={styles.fileActions}>
                {selected.deleted_at ? <Button size="sm" variant="primary" icon={<RotateCcw />} onClick={() => mutate.mutate(() => roomsApi.restoreEntry(roomId, selected.id))}>Restore</Button> : <>
                  {planModeEnabled&&selected.path==='plan.md'&&viewed?.id===current?.id&&!editingPlan&&<Button size="sm" variant="secondary" icon={<Pencil/>} onClick={()=>setEditingPlan(true)}>Edit</Button>}
                  {onAttach && current && <Button className={styles.attachButton} size="sm" variant="primary" icon={<Paperclip />} onClick={attach}><span>Attach</span></Button>}
                  {viewed && <a className={styles.iconLink} href={viewed.url} aria-label="Download file" title="Download"><Download /></a>}
                  {(!planModeEnabled||selected.path!=='plan.md')&&<div className={styles.menuAnchor} ref={fileMenuRef}>
                    <IconButton aria-label="File actions" title="Actions" onClick={() => setFileMenu(value => !value)}><MoreHorizontal /></IconButton>
                    {fileMenu && <div className={`${styles.menu} ${styles.fileMenu}`} role="menu">
                      <button role="menuitem" onClick={() => { setFileMenu(false); setOperation({ kind: 'rename', entry: selected }); }}>Rename</button>
                      <button role="menuitem" onClick={() => { setFileMenu(false); setOperation({ kind: 'move', entry: selected }); }}>Move</button>
                      <button role="menuitem" className={styles.dangerItem} onClick={() => { setFileMenu(false); setOperation({ kind: 'delete', entry: selected }); }}><Trash2 />Delete</button>
                    </div>}
                  </div>}
                </>}
              </div>
            </header>
            <div className={styles.tabs} role="tablist">
              <button role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? styles.activeTab : ''} onClick={() => setTab('preview')}>Preview</button>
              <button role="tab" aria-selected={tab === 'versions'} className={tab === 'versions' ? styles.activeTab : ''} onClick={() => setTab('versions')}><History />Versions{versions.data ? <em>{versions.data.length}</em> : null}</button>
            </div>
            {tab === 'preview' ? planModeEnabled&&editingPlan&&current?<PlanEditor version={current} save={async content=>{await mutate.mutateAsync(()=>roomsApi.updatePlan(roomId,content,current.id));setEditingPlan(false);await versions.refetch();}} cancel={()=>setEditingPlan(false)}/>:<FilePreview selected={selected} current={viewed} /> : <VersionHistory versions={versions.data ?? []} selected={selected} current={current} viewed={viewed} approvedVersionId={planModeEnabled?plan?.approved?.version_id:undefined} compare={compare} setCompare={setCompare} view={version=>{setViewVersionId(version.id);setTab('preview')}} restore={version => mutate.mutate(() => roomsApi.restoreVersion(roomId, version.id))} />}
          </> : <div className={styles.viewerEmpty}><File /><strong>{trash ? 'Select a deleted file' : 'Select a file'}</strong><span>{trash ? 'You can preview and restore it.' : 'Its contents will open here.'}</span></div>}
        </main>}
      </div>
    </>}
    {operation && <OperationDialog operation={operation} directory={uploadDirectory} pending={mutate.isPending} onClose={() => setOperation(undefined)} onSubmit={submitOperation} />}
  </aside>;
}

function TreeRow({ node, depth, expanded, selectedId, activeDirectory, trash, planModeEnabled,onFolder, onFile, onRename }: {
  node: WorkspaceTreeNode;
  depth: number;
  expanded: Set<string>;
  selectedId?: string;
  activeDirectory: string;
  trash: boolean;
  planModeEnabled:boolean;
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
      onDoubleClick={() => !trash && (!planModeEnabled||entry?.path!=='plan.md') && entry && onRename(entry)}
    >
      {node.kind === 'directory' ? <ChevronRight className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} /> : <span className={styles.chevronSpace} />}
      {node.kind === 'directory' ? open ? <FolderOpen /> : <Folder /> : <File />}
      <span>{node.name}</span>
      {entry?.status === 'oversize' && <em>oversize</em>}
    </button>
    {node.kind === 'directory' && open && node.children.map(child => <TreeRow key={child.path} node={child} depth={depth + 1} expanded={expanded} selectedId={selectedId} activeDirectory={activeDirectory} trash={trash} planModeEnabled={planModeEnabled} onFolder={onFolder} onFile={onFile} onRename={onRename} />)}
  </div>;
}

function ExplorerMessage({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return <div className={styles.explorerMessage}>{icon}<span>{children}</span></div>;
}

function FilePreview({ selected, current }: { selected: WorkspaceEntry; current?: WorkspaceVersion }) {
  if (!current) return <div className={styles.previewFallback}><File /><span>Preview is not available yet</span></div>;
  if (selected.mime_type === 'text/html') return <div className={styles.preview}><IsolatedHtmlPreview title={selected.name} previewUrl={current.preview_url}/></div>;
  if (selected.mime_type === 'text/markdown') return <div className={styles.preview}><MarkdownPreview url={current.preview_url} /></div>;
  if (selected.mime_type.startsWith('image/')) return <div className={`${styles.preview} ${styles.imagePreview}`}><img src={current.preview_url} alt={selected.name} /></div>;
  if (selected.mime_type.startsWith('text/') || selected.mime_type === 'application/json') return <div className={styles.preview}><iframe title={selected.name} src={current.preview_url} sandbox="" /></div>;
  return <div className={styles.previewFallback}><File /><strong>Preview unavailable</strong><span>{selected.mime_type}</span></div>;
}

function VersionHistory({ versions, selected, current,viewed,approvedVersionId, compare, setCompare,view, restore }: {
  versions: WorkspaceVersion[];
  selected: WorkspaceEntry;
  current?: WorkspaceVersion;
  viewed?:WorkspaceVersion;
  approvedVersionId?:string;
  compare?: WorkspaceVersion;
  setCompare: (version?: WorkspaceVersion) => void;
  view:(version:WorkspaceVersion)=>void;
  restore: (version: WorkspaceVersion) => void;
}) {
  return <div className={styles.history}>
    {!versions.length && <div className={styles.viewerEmpty}><History /><strong>No versions yet</strong></div>}
    {versions.map((version, index) => <div className={styles.versionRow} key={version.id}>
      <span><strong>{version.id === current?.id ? 'Current version' : `Version ${versions.length - index}`}{version.id===approvedVersionId?' · Approved':''}{version.id===viewed?.id?' · Viewing':''}</strong><small>{new Date(version.created_at).toLocaleString('en-US')} · {version.source}{version.run_ids.length ? ` · ${version.run_ids.length} run` : ''}</small></span>
      <div>
        <IconButton aria-label="Preview version" title="Preview" onClick={()=>view(version)}><File/></IconButton>
      {version.id !== current?.id && <>
        {selected.mime_type.startsWith('text/') && <IconButton aria-label="Compare version" title="Compare" onClick={() => setCompare(version)}><GitCompare /></IconButton>}
        <IconButton aria-label="Restore version" title="Restore" onClick={() => restore(version)}><RotateCcw /></IconButton>
      </>}
      </div>
    </div>)}
    {compare && current && <TextDiff before={compare.preview_url} after={current.preview_url} close={() => setCompare(undefined)} />}
  </div>;
}

function PlanEditor({version,save,cancel}:{version:WorkspaceVersion;save:(content:string)=>Promise<void>;cancel:()=>void}){
  const[text,setText]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState<string>();
  useEffect(()=>{const controller=new AbortController();setLoading(true);fetch(version.preview_url,{signal:controller.signal}).then(response=>response.text()).then(value=>{setText(value);setLoading(false)}).catch(value=>{if(value?.name!=='AbortError'){setError(String(value));setLoading(false)}});return()=>controller.abort()},[version.id,version.preview_url]);
  const submit=async()=>{if(!text.trim()||saving)return;setSaving(true);setError(undefined);try{await save(text)}catch(value){setError(value instanceof Error?value.message:String(value))}finally{setSaving(false)}};
  return <section className={styles.planEditor}><header><span><strong>Editing plan.md</strong><small>Saving creates a new immutable version.</small></span><div><Button size="sm" variant="secondary" disabled={saving} onClick={cancel}>Cancel</Button><Button size="sm" variant="primary" disabled={loading||saving||!text.trim()} onClick={()=>void submit()}>{saving?'Saving…':'Save version'}</Button></div></header>{error&&<Alert tone="error">{error}</Alert>}<textarea aria-label="Plan Markdown" value={text} disabled={loading||saving} onChange={event=>setText(event.target.value)} spellCheck={false}/></section>;
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
  const title = operation.kind === 'create' ? 'Create folder' : operation.kind === 'rename' ? 'Rename file' : operation.kind === 'move' ? 'Move file' : 'Delete file';
  const description = operation.kind === 'delete' ? `“${operation.entry.path}” will be moved to the trash.` : operation.kind === 'rename' ? `Current path: ${operation.entry.path}` : operation.kind === 'move' ? 'Enter the new full path, including the file name.' : `The folder will be created in ${directory || 'the workspace root'}.`;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim().replace(/^\/+|\/+$/g, '');
    if (operation.kind !== 'delete' && !next) return setValidation('Enter a non-empty value.');
    if ((operation.kind === 'create' || operation.kind === 'rename') && next.includes('/')) return setValidation('The name must not contain “/”.');
    if (operation.kind === 'rename' && next === operation.entry.name) return setValidation('The name has not changed.');
    if (operation.kind === 'move' && next === operation.entry.path) return setValidation('The path has not changed.');
    setValidation(undefined);
    try {
      await onSubmit(operation.kind === 'delete' ? undefined : next);
    } catch {
      // Mutation errors are shown in the drawer alert and the dialog stays open.
    }
  };
  return <Dialog open title={title} description={description} onClose={onClose} footer={<>
    <Button variant="secondary" disabled={pending} onClick={onClose}>Cancel</Button>
    <Button variant={operation.kind === 'delete' ? 'danger' : 'primary'} disabled={pending} type="submit" form="workspace-operation">{pending ? 'Saving…' : operation.kind === 'delete' ? 'Move to trash' : 'Save'}</Button>
  </>}>
    <form id="workspace-operation" className={styles.operationForm} onSubmit={submit}>
      {operation.kind !== 'delete' && <label><span>{operation.kind === 'move' ? 'New path' : operation.kind === 'rename' ? 'New name' : 'Folder name'}</span><Input autoFocus value={value} onChange={event => { setValue(event.target.value); setValidation(undefined); }} aria-invalid={Boolean(validation)} /></label>}
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
  return <section className={styles.diff}><header><strong>Changes from the selected version</strong><IconButton aria-label="Close comparison" onClick={close}><X /></IconButton></header><pre>{Array.from({ length }, (_, index) => left[index] === right[index] ? `  ${right[index] ?? ''}` : `- ${left[index] ?? ''}\n+ ${right[index] ?? ''}`).join('\n')}</pre></section>;
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
  if (!response.ok) throw new Error(`Failed to load trash: HTTP ${response.status}`);
  return response.json() as Promise<RoomWorkspace>;
}

function toAttachment(version: WorkspaceVersion): WorkspaceAttachment {
  return { version_id: version.id, ...(version.entry_id?{entry_id:version.entry_id}:{}), path: version.path, name: version.path.split('/').pop() ?? version.path, size: version.size, mime_type: version.mime_type, url: version.url, preview_url: version.preview_url };
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function parentPath(path: string) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function clampStoredWidth(value: number) {
  return Math.max(560, Math.min(900, value));
}
