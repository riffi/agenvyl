import type { WorkspaceAttachment } from '@agenvyl/contracts';

export type WorkspaceViewMode = 'rendered' | 'source';
export type WorkspaceSection = 'app' | 'files';
export type WorkspaceOpenOrigin = 'workspace' | 'artifact';
export type WorkspaceEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1251' | 'windows-1252' | 'koi8-r';

export type WorkspaceTarget = {
  entryId?: string;
  versionId?: string;
  path?: string;
};

export type WorkspacePaneState = {
  target?: WorkspaceTarget;
  mode?: WorkspaceViewMode;
  encoding?: WorkspaceEncoding;
  followCurrent?: boolean;
};

export type WorkspaceViewState = {
  open: boolean;
  treeVisible: boolean;
  primaryPane: WorkspacePaneState;
  secondaryPane?: WorkspacePaneState;
};

export type WorkspaceOpenRequest = {
  origin: WorkspaceOpenOrigin;
  section?: WorkspaceSection;
  buildRunId?: string;
  target?: WorkspaceTarget;
  mode?: WorkspaceViewMode;
  encoding?: WorkspaceEncoding;
  treeVisible?: boolean;
  gallery?: WorkspaceAttachment[];
  opener?: HTMLElement | null;
  followCurrent?: boolean;
};

export type OpenWorkspaceArtifact = (
  attachment: WorkspaceAttachment,
  gallery?: WorkspaceAttachment[],
  opener?: HTMLElement | null,
  options?: { section?: WorkspaceSection; buildRunId?: string },
) => void;

export const workspaceRequestForTarget = (
  target?: WorkspaceTarget,
  compact = isCompactWorkspace(),
): WorkspaceOpenRequest => ({
  origin: 'workspace',
  target,
  treeVisible: !target || !compact,
  followCurrent: !target?.versionId,
});

export type WorkspaceRequestUpdate = {
  section?: WorkspaceSection;
  buildRunId?: string;
  target?: WorkspaceTarget;
  mode?: WorkspaceViewMode;
  treeVisible?: boolean;
  encoding?: WorkspaceEncoding;
  followCurrent?: boolean;
  gallery?: WorkspaceAttachment[];
};

export const applyWorkspaceRequestUpdate = (
  current: WorkspaceOpenRequest,
  update: WorkspaceRequestUpdate,
): WorkspaceOpenRequest => ({
  ...current,
  ...update,
  target: Object.prototype.hasOwnProperty.call(update, 'target')
    ? update.target ? { ...current.target, ...update.target } : undefined
    : current.target,
  gallery: Object.prototype.hasOwnProperty.call(update, 'gallery') ? update.gallery : current.gallery,
});

const sourceExtensions = new Set([
  'bash','c','cc','cfg','conf','cpp','cs','css','csv','env','go','graphql','h','hpp','ini','java','js','jsx',
  'json','kt','log','lua','md','mjs','php','properties','ps1','py','rb','rs','scss','sh','sql','swift','toml',
  'ts','tsx','txt','xml','yaml','yml',
]);

const extensionOf = (path: string) => {
  const name = path.split('/').pop() ?? path;
  const index = name.lastIndexOf('.');
  return index > -1 ? name.slice(index + 1).toLowerCase() : name.startsWith('.') ? name.slice(1).toLowerCase() : '';
};

export const isTextWorkspaceItem = (item: Pick<WorkspaceAttachment, 'path' | 'mime_type'>) => {
  if (item.mime_type.startsWith('text/')) return true;
  if (/^(application\/(json|ld\+json|xml|yaml|javascript|typescript|sql|graphql))$/.test(item.mime_type)) return true;
  return sourceExtensions.has(extensionOf(item.path));
};

export const workspaceModesFor = (item: Pick<WorkspaceAttachment, 'path' | 'mime_type'>): WorkspaceViewMode[] => {
  const extension = extensionOf(item.path);
  if (item.mime_type === 'text/html' || item.mime_type === 'text/markdown' || item.mime_type === 'image/svg+xml' || ['html','htm','md','markdown','svg'].includes(extension)) {
    return ['rendered', 'source'];
  }
  return isTextWorkspaceItem(item) ? ['source'] : ['rendered'];
};

export const defaultWorkspaceMode = (item: Pick<WorkspaceAttachment, 'path' | 'mime_type'>) =>
  workspaceModesFor(item)[0];

export const workspaceLanguageFor = (path: string, mimeType: string) => {
  const extension = extensionOf(path);
  const aliases: Record<string, string> = {
    bash:'shell', c:'c', cc:'cpp', cpp:'cpp', cs:'csharp', css:'css', go:'go', graphql:'graphql',
    h:'c', hpp:'cpp', html:'html', htm:'html', ini:'ini', java:'java', js:'javascript', jsx:'javascript',
    json:'json', kt:'kotlin', lua:'lua', md:'markdown', markdown:'markdown', mjs:'javascript', php:'php',
    ps1:'powershell', py:'python', rb:'ruby', rs:'rust', scss:'scss', sh:'shell', sql:'sql', swift:'swift',
    toml:'ini', ts:'typescript', tsx:'typescript', xml:'xml', yaml:'yaml', yml:'yaml',
  };
  if (aliases[extension]) return aliases[extension];
  if (mimeType === 'application/json') return 'json';
  if (mimeType === 'text/markdown') return 'markdown';
  if (mimeType === 'text/html') return 'html';
  return 'plaintext';
};

export const workspaceAttachmentFromVersion = (version: {
  id: string;
  entry_id?: string;
  path: string;
  size: number;
  mime_type: string;
  url: string;
  preview_url: string;
}): WorkspaceAttachment => ({
  version_id: version.id,
  ...(version.entry_id ? { entry_id: version.entry_id } : {}),
  path: version.path,
  name: version.path.split('/').pop() ?? version.path,
  size: version.size,
  mime_type: version.mime_type,
  url: version.url,
  preview_url: version.preview_url,
});

export const workspaceRequestFromSearch = (search: URLSearchParams): WorkspaceOpenRequest | undefined => {
  if (search.get('workspace') !== '1') return undefined;
  const entryId = search.get('wsEntry') || undefined;
  const versionId = search.get('wsVersion') || undefined;
  const modeValue = search.get('wsView');
  const mode = modeValue === 'source' || modeValue === 'rendered' ? modeValue : undefined;
  const sectionValue = search.get('wsSection');
  const section = sectionValue === 'app' || sectionValue === 'files' ? sectionValue : undefined;
  return {
    origin: search.get('wsOrigin') === 'artifact' ? 'artifact' : 'workspace',
    section,
    buildRunId: search.get('wsBuild') || undefined,
    treeVisible: search.get('wsTree') !== '0',
    mode,
    target: entryId || versionId ? { entryId, versionId } : undefined,
  };
};

export const workspaceSearchWithRequest = (current: URLSearchParams, request?: WorkspaceOpenRequest | WorkspaceRequestUpdate) => {
  const next = new URLSearchParams(current);
  ['workspace','wsEntry','wsVersion','wsView','wsTree','wsOrigin','wsSection','wsBuild'].forEach(key => next.delete(key));
  if (!request) return next;
  next.set('workspace', '1');
  const target = request.target;
  if (target?.entryId) next.set('wsEntry', target.entryId);
  if (target?.versionId) next.set('wsVersion', target.versionId);
  if (request.mode) next.set('wsView', request.mode);
  if (request.section) next.set('wsSection', request.section);
  if (request.buildRunId) next.set('wsBuild', request.buildRunId);
  next.set('wsTree', request.treeVisible === false ? '0' : '1');
  if ('origin' in request) next.set('wsOrigin', request.origin);
  return next;
};

const isCompactWorkspace = () =>
  typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches;
