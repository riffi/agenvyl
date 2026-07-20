import {describe,expect,it} from 'vitest';
import type {WorkspaceEntry} from '@agenvyl/contracts';
import {attachmentFromEntry,currentWorkspaceFiles} from './attachments';

const entry=(value:Partial<WorkspaceEntry>&Pick<WorkspaceEntry,'id'|'path'|'name'>):WorkspaceEntry=>({kind:'file',size:10,mime_type:'text/plain',updated_at:'2026-01-01T00:00:00.000Z',current_version_id:`version-${value.id}`,...value});

describe('message attachments',()=>{
  it('keeps only attachable current files and sorts recent first',()=>{
    const files=currentWorkspaceFiles([entry({id:'old',path:'old.txt',name:'old.txt'}),entry({id:'new',path:'new.txt',name:'new.txt',updated_at:'2026-02-01T00:00:00.000Z'}),entry({id:'deleted',path:'deleted.txt',name:'deleted.txt',deleted_at:'2026-01-01T00:00:00.000Z'}),entry({id:'folder',path:'folder',name:'folder',kind:'directory'})]);
    expect(files.map(file=>file.id)).toEqual(['new','old']);
  });
  it('builds deterministic current-version URLs',()=>{
    expect(attachmentFromEntry('room / one',entry({id:'one',path:'docs/a.txt',name:'a.txt'}))).toMatchObject({version_id:'version-one',path:'docs/a.txt',url:'/api/v1/rooms/room%20%2F%20one/workspace/versions/version-one'});
  });
});
