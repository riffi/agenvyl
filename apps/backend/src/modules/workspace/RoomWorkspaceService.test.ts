import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {RoomWorkspaceService} from './RoomWorkspaceService.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

function fixture(root:string,max=1024,activeValues:()=>any[]=()=>[],planModeEnabled?:boolean){
  const entries=new Map<string,any>(),versions=new Map<string,any>();
  const repository={
    list:vi.fn(async()=>[...entries.values()]),entry:vi.fn(async(_room:string,p:string)=>entries.get(p)),entryById:vi.fn(async(_room:string,id:string)=>[...entries.values()].find(value=>value.id===id)),
    version:vi.fn(async(_room:string,id:string)=>versions.get(id)),
    currentVersion:vi.fn(async(_room:string,filePath:string)=>{const entry=entries.get(filePath);return entry?.current_version_id?versions.get(entry.current_version_id):undefined;}),
    saveVersion:vi.fn(async(input:any)=>{const prior=entries.get(input.path),id=prior?.id??crypto.randomUUID(),version={id:crypto.randomUUID(),entry_id:id,room_id:input.roomId,...input,created_at:new Date().toISOString()};const entry={id,path:input.path,name:path.basename(input.path),kind:'file',size:input.size,mime_type:input.mimeType,updated_at:new Date().toISOString(),current_version_id:version.id,deleted_at:null,status:'tracked'};entries.set(input.path,entry);versions.set(version.id,version);return{entry,version,created:!prior};}),
    saveDirectory:vi.fn(),markOversize:vi.fn(),
    softDelete:vi.fn(async(_room:string,id:string)=>{const entry=[...entries.values()].find(value=>value.id===id);if(!entry)return[];entry.deleted_at=new Date().toISOString();return[entry];}),
    move:vi.fn(async(_room:string,id:string,nextPath:string)=>{const entry=[...entries.values()].find(value=>value.id===id);if(!entry)return undefined;entries.delete(entry.path);entry.path=nextPath;entry.name=path.basename(nextPath);entries.set(nextPath,entry);return entry;}),
    restoreEntry:vi.fn(),versions:vi.fn(),linkArtifacts:vi.fn(),
  };
  const rooms={exists:vi.fn().mockResolvedValue(true),hasActivePlanRun:vi.fn().mockImplementation(async()=>activeValues().some(run=>run.executionProfile?.workflowMode==='plan'&&!run.terminal)),clearApprovedPlan:vi.fn().mockResolvedValue({plan:{approved:null}})},events={emit:vi.fn()};
  const service=new RoomWorkspaceService(rooms as never,repository as never,events as never,{values:activeValues} as never,root,'/host/workspaces',max,planModeEnabled);
  return{service,repository,rooms,events};
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
    expect(repository.saveVersion).toHaveBeenCalledWith(expect.objectContaining({path:'result.txt',runIds:['running'],artifactChange:'created'}));service.close();
  });

  it('creates plan.md from a run and conditionally saves manual versions',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'room-plan-'));roots.push(root);const{service,repository}=fixture(root);
    const created=await service.savePlanFromRun('room-1','plan-run','# First plan');
    expect(created.entry.path).toBe('plan.md');
    expect(repository.saveVersion).toHaveBeenCalledWith(expect.objectContaining({path:'plan.md',runIds:['plan-run'],artifactChange:'created',force:true}));
    await expect(service.updatePlan('room-1','# Edited','stale')).rejects.toMatchObject({code:'plan_version_conflict'});
    const edited=await service.updatePlan('room-1','# Edited',created.version.id);
    expect(edited.version.id).not.toBe(created.version.id);
    expect(await readFile(path.join(root,'room-1','plan.md'),'utf8')).toBe('# Edited');
    service.close();
  });

  it('rejects a manual save while a Plan run is active',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'room-plan-active-'));roots.push(root);const run={roomId:'room-1',terminal:false,executionProfile:{workflowMode:'plan'}},{service}=fixture(root,1024,()=>[run]);
    await expect(service.updatePlan('room-1','# Concurrent edit','version-1')).rejects.toMatchObject({code:'plan_run_active',statusCode:409});
    service.close();
  });

  it('blocks the Plan editor but treats plan.md as an ordinary movable and deletable file when disabled',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'room-plan-disabled-'));roots.push(root);const{service,rooms}=fixture(root,1024,()=>[],false);
    const uploaded=await service.upload('room-1','plan.md','text/markdown',Buffer.from('# Existing plan'));
    await expect(service.updatePlan('room-1','# Edited',uploaded.version.id)).rejects.toMatchObject({code:'plan_mode_disabled',statusCode:409});
    await service.move('room-1',uploaded.entry.id,'notes/old-plan.md');
    expect(rooms.clearApprovedPlan).toHaveBeenCalledTimes(1);
    const replacement=await service.upload('room-1','plan.md','text/markdown',Buffer.from('# Replacement'));
    await service.remove('room-1',replacement.entry.id);
    expect(rooms.clearApprovedPlan).toHaveBeenCalledTimes(2);
    service.close();
  });
});
