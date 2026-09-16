// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {RoomWorkspace, WorkspaceAttachment} from '@agenvyl/contracts';
import {roomsApi} from '../../entities/room';
import {openWorkspaceFileLink} from './openWorkspaceFileLink';

const roomId = '378c610f-cd8d-4b15-bf99-bce15eeb3da9';
const root = `/home/vladimir/repos/agenvyl-devstand/var-devstand/room-workspaces/${roomId}`;
const artifact: WorkspaceAttachment = {path:'pogonya-za-tretey.md',name:'pogonya-za-tretey.md',size:23603,mime_type:'text/markdown',version_id:'captured-version',entry_id:'captured-entry',url:'/version',preview_url:'/preview'};
const workspace = {path:root,entries:[{id:'current-entry',path:artifact.path,kind:'file',current_version_id:'current-version'}]} as RoomWorkspace;
afterEach(()=>vi.restoreAllMocks());
describe('room workspace file links',()=>{
  it.each([`${root}/${artifact.path}`, `workspace:${artifact.path}`])('opens the response snapshot for %s without a project',async href=>{
    vi.spyOn(roomsApi,'workspace').mockResolvedValue(workspace);
    const open=vi.fn(),opener=document.createElement('button');
    expect(await openWorkspaceFileLink(roomId,href,[artifact],opener,open)).toBe(true);
    expect(roomsApi.workspace).toHaveBeenCalledWith(roomId);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({source:'workspace',origin:'artifact',followCurrent:false,opener,target:{path:artifact.path,entryId:'captured-entry',versionId:'captured-version'}}));
  });
  it('opens an existing workspace file when the response has no artifact',async()=>{
    vi.spyOn(roomsApi,'workspace').mockResolvedValue(workspace);
    const open=vi.fn();
    expect(await openWorkspaceFileLink(roomId,`workspace:${artifact.path}`,[],document.createElement('button'),open)).toBe(true);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({source:'workspace',target:{path:artifact.path,entryId:'current-entry',versionId:'current-version'}}));
  });
  it.each([`/other/${artifact.path}`,`${root}-other/${artifact.path}`,`${root}/../${artifact.path}`,`workspace:../${artifact.path}`,`workspace:%2e%2e/${artifact.path}`,`project:${artifact.path}`,'workspace:missing.md'])('does not match another root, traversal or missing file: %s',async href=>{
    vi.spyOn(roomsApi,'workspace').mockResolvedValue(workspace);
    const open=vi.fn();
    expect(await openWorkspaceFileLink(roomId,href,[artifact],document.createElement('button'),open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
  it('still opens captured contents after the live file is deleted',async()=>{
    vi.spyOn(roomsApi,'workspace').mockResolvedValue({...workspace,entries:[]});
    expect(await openWorkspaceFileLink(roomId,`workspace:${artifact.path}`,[artifact],document.createElement('button'),vi.fn())).toBe(true);
  });
});
