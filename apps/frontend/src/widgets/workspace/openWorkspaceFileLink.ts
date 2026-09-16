import type {WorkspaceAttachment} from '@agenvyl/contracts';
import {roomsApi} from '../../entities/room';
import {resolveFileLinkPath} from '../../shared/project-references/projectFileLink';
import type {WorkspaceOpenRequest} from '../workspace-window';

export const openWorkspaceFileLink = async (
  roomId: string,
  href: string,
  artifacts: WorkspaceAttachment[],
  opener: HTMLElement,
  open: (request: WorkspaceOpenRequest) => void,
) => {
  const workspace = await roomsApi.workspace(roomId);
  const target = resolveFileLinkPath(href, workspace.path, 'workspace');
  if (!target) return false;
  const artifact = artifacts.find(item => item.path === target.path);
  const entry = workspace.entries.find(item => item.path === target.path && item.kind === 'file' && !item.deleted_at);
  // Prefer the captured version from this response over the current contents.
  const versionId = artifact?.version_id ?? entry?.current_version_id;
  if (!versionId) return false;
  open({
    origin: artifact ? 'artifact' : 'workspace', source: 'workspace', section: 'files',
    target: {path: target.path, entryId: artifact?.entry_id ?? entry?.id, versionId},
    treeVisible: false, followCurrent: false, opener,
  });
  return true;
};
