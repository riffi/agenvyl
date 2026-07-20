import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {RoomWorkspaceService} from './RoomWorkspaceService.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

function fixture(root:string,max=1024,activeValues:()=>any[]=()=>[]){
  const entries=new Map<string,any>(),versions=new Map<string,any>();
  const repository={
    list:vi.fn(async()=>[...entries.values()]),entry:vi.fn(async(_room:string,p:string)=>entries.get(p)),entryById:vi.fn(async(_room:string,id:string)=>[...entries.values()].find(value=>value.id===id)),
    version:vi.fn(async(_room:string,id:string)=>versions.get(id)),
    saveVersion:vi.fn(async(input:any)=>{const prior=entries.get(input.path),id=prior?.id??crypto.randomUUID(),version={id:crypto.randomUUID(),entry_id:id,room_id:input.roomId,...input,created_at:new Date().toISOString()};const entry={id,path:input.path,name:path.basename(input.path),kind:'file',size:input.size,mime_type:input.mimeType,updated_at:new Date().toISOString(),current_version_id:version.id,deleted_at:null,status:'tracked'};entries.set(input.path,entry);versions.set(version.id,version);return{entry,version,created:!prior};}),
    saveDirectory:vi.fn(),markOversize:vi.fn(),softDelete:vi.fn(),move:vi.fn(),restoreEntry:vi.fn(),versions:vi.fn(),linkArtifacts:vi.fn(),
  };
  const service=new RoomWorkspaceService({exists:vi.fn().mockResolvedValue(true)} as never,repository as never,{emit:vi.fn()} as never,{values:activeValues} as never,root,'/host/workspaces',max);
  return{service,repository};
}

describe('RoomWorkspaceService',()=>{
  it('stores arbitrary uploaded files as immutable versions in the isolated room directory',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'room-workspace-'));roots.push(root);const{service}=fixture(root);
    const uploaded=await service.upload('room-1',encodeURIComponent('docs/заметки.md'),'text/markdown',Buffer.from('# notes'));
    expect(uploaded).toMatchObject({entry:{name:'заметки.md',mime_type:'text/markdown',size:7},version:{sha256:expect.any(String)}});
    expect(await readFile(path.join(root,'room-1','docs','заметки.md'),'utf8')).toBe('# notes');
    expect((await service.list('room-1')).entries).toEqual(expect.arrayContaining([expect.objectContaining({path:'docs/заметки.md'})]));
    service.close();
  });

  it('rejects traversal and asks for an explicit collision strategy',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'room-workspace-'));roots.push(root);const{service}=fixture(root,10);
    await expect(service.upload('room-1','..%2Fsecret.png','image/png',Buffer.from('x'))).rejects.toMatchObject({code:'invalid_file_name'});
    await service.upload('room-1','notes.txt','text/plain',Buffer.from('x'));
    await expect(service.upload('room-1','notes.txt','text/plain',Buffer.from('x'))).rejects.toMatchObject({code:'file_exists'});
    await expect(service.upload('room-1','large.bin','application/octet-stream',Buffer.alloc(11))).rejects.toMatchObject({code:'file_too_large'});
    service.close();
  });

  it('attributes filesystem changes only to runs that have actually started',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'room-workspace-'));roots.push(root);const running={id:'running',roomId:'room-1',started:true,terminal:false},queued={id:'queued',roomId:'room-1',started:false,terminal:false},{service,repository}=fixture(root,1024,()=>[running,queued]);
    await service.ensure('room-1');await writeFile(path.join(root,'room-1','result.txt'),'ready');await service.list('room-1');
    expect(repository.linkArtifacts).toHaveBeenCalledWith(['running'],expect.objectContaining({path:'result.txt'}),'created','exact');service.close();
  });
});
