import {mkdir,mkdtemp,readFile,rm,stat,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import type {RunExecutionProfileSnapshot} from '@agenvyl/contracts';
import {createRepositories} from '../../infrastructure/database/createRepositories.js';
import {RoomEventBus} from '../room-events/RoomEventBus.js';
import {RoomEventService} from '../room-events/RoomEventService.js';
import {ActiveRunRegistry} from '../runs/ActiveRunRegistry.js';
import {testDatabaseUrl} from '../../testDatabase.js';
import {RoomWorkspaceService} from './RoomWorkspaceService.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});

const profile:RunExecutionProfileSnapshot={workflowMode:'work',requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:null,agentVariantId:null,implementationPlanVersionId:null};
const finalizeRun=async(repositories:Awaited<ReturnType<typeof createRepositories>>,service:RoomWorkspaceService,runId:string,status:'completed'|'failed'|'cancelled')=>{
  await repositories.database.sql`UPDATE agent_runs SET status=${status} WHERE id=${runId}`;
  return service.finalizeRun('demo-room',runId,status);
};

describe('isolated run workspace snapshots',()=>{
  it('gives parallel runs separate cwd, captures exact manifests, and exposes a three-way conflict',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'run-snapshots-'));roots.push(root);
    const repositories=await createRepositories(testDatabaseUrl('isolated_run_snapshots'));
    const events=new RoomEventService(repositories.roomEvents,new RoomEventBus()),service=new RoomWorkspaceService(repositories.rooms,repositories.workspace,events,new ActiveRunRegistry(),root,root,1024*1024,true,repositories.workspaceSnapshots);
    try{
      await service.upload('demo-room','site/index.html','text/html',Buffer.from('<link rel="stylesheet" href="style.css">'));
      await service.upload('demo-room','site/style.css','text/css',Buffer.from('body{color:black}'));
      const personas=(await repositories.personas.list('demo-room')).slice(0,3),profiles=new Map(personas.map(persona=>[persona.id,profile]));
      const round=await repositories.messages.createRound('demo-room','parallel edit',personas,profiles);
      const [first,second,third]=round.runs;
      const workspaces=await Promise.all(round.runs.map(run=>service.prepareRun('demo-room',run.id)));
      expect(new Set(workspaces.map(workspace=>workspace.absolutePath)).size).toBe(3);
      expect(await stat(path.join(root,'demo-room','.agenvyl','.managed')).then(item=>item.isFile())).toBe(true);
      await finalizeRun(repositories,service,third.id,'failed');
      await Promise.all([
        writeFile(path.join(service.runPath('demo-room',first.id),'site','style.css'),'body{color:red}'),
        writeFile(path.join(service.runPath('demo-room',second.id),'site','style.css'),'body{color:blue}'),
      ]);
      const firstResult=await finalizeRun(repositories,service,first.id,'completed'),secondResult=await finalizeRun(repositories,service,second.id,'completed');
      expect(firstResult).toMatchObject({capture_status:'complete',publish_status:'published',conflict_count:0});
      expect(secondResult).toMatchObject({capture_status:'complete',publish_status:'partially_published',conflict_count:1});
      expect(await stat(path.dirname(service.runPath('demo-room',first.id))).then(()=>true).catch(()=>false)).toBe(false);
      expect(await stat(path.dirname(service.runPath('demo-room',second.id))).then(()=>true).catch(()=>false)).toBe(false);
      const firstFile=await service.resolveSnapshotFile('demo-room',firstResult!.result_snapshot_id!,'site/style.css'),secondFile=await service.resolveSnapshotFile('demo-room',secondResult!.result_snapshot_id!,'site/style.css');
      expect(await import('node:fs/promises').then(fs=>fs.readFile(firstFile.path,'utf8'))).toBe('body{color:red}');
      expect(await import('node:fs/promises').then(fs=>fs.readFile(secondFile.path,'utf8'))).toBe('body{color:blue}');
      const conflicts=await service.conflicts('demo-room',second.id);expect(conflicts.conflicts).toHaveLength(1);expect(conflicts.conflicts[0]).toMatchObject({path:'site/style.css',current:{attachment:{snapshot_id:conflicts.expected_current_snapshot_id}},candidate:{attachment:{snapshot_id:secondResult!.result_snapshot_id}}});
      await service.upload('demo-room','site/style.css','text/css',Buffer.from('body{color:green}'),'replace');
      await expect(service.resolveConflicts('demo-room',second.id,{expected_current_snapshot_id:conflicts.expected_current_snapshot_id,resolutions:[{path:'site/style.css',choice:'candidate'}]})).rejects.toMatchObject({code:'workspace_conflict_stale'});
      const refreshed=await service.conflicts('demo-room',second.id);expect(refreshed.expected_current_snapshot_id).not.toBe(conflicts.expected_current_snapshot_id);
      const resolved=await service.resolveConflicts('demo-room',second.id,{expected_current_snapshot_id:refreshed.expected_current_snapshot_id,resolutions:[{path:'site/style.css',choice:'candidate'}]});
      expect(resolved).toMatchObject({publish_status:'published',conflict_count:0});
      const current=await repositories.workspace.currentVersion('demo-room','site/style.css');expect(current?.sha256).toBe(secondFile.version.sha256);
    }finally{service.close();await repositories.database.close()}
  });

  it('saves but does not publish a failed run snapshot',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'failed-snapshot-'));roots.push(root);
    const repositories=await createRepositories(testDatabaseUrl('failed_run_snapshot'));
    const service=new RoomWorkspaceService(repositories.rooms,repositories.workspace,new RoomEventService(repositories.roomEvents,new RoomEventBus()),new ActiveRunRegistry(),root,root,1024*1024,true,repositories.workspaceSnapshots);
    try{
      const [persona]=(await repositories.personas.list('demo-room')),round=await repositories.messages.createRound('demo-room','failed edit',[persona],new Map([[persona.id,profile]])),run=round.runs[0];
      await service.prepareRun('demo-room',run.id);await writeFile(path.join(service.runPath('demo-room',run.id),'draft.txt'),'captured');
      const result=await finalizeRun(repositories,service,run.id,'failed');
      expect(result).toMatchObject({capture_status:'complete',publish_status:'not_published'});
      expect(await stat(path.dirname(service.runPath('demo-room',run.id))).then(()=>true).catch(()=>false)).toBe(false);
      expect(await repositories.workspace.currentVersion('demo-room','draft.txt')).toBeUndefined();
      expect(await service.resolveSnapshotFile('demo-room',result!.result_snapshot_id!,'draft.txt')).toMatchObject({contentType:'text/plain'});
    }finally{service.close();await repositories.database.close()}
  });

  it('short-circuits an unchanged run without snapshot or materialization churn',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'noop-snapshot-'));roots.push(root);
    const repositories=await createRepositories(testDatabaseUrl('noop_run_snapshot'));
    const service=new RoomWorkspaceService(repositories.rooms,repositories.workspace,new RoomEventService(repositories.roomEvents,new RoomEventBus()),new ActiveRunRegistry(),root,root,1024*1024,true,repositories.workspaceSnapshots,undefined,{noopMode:'on'},repositories.workspaceSlots);
    try{
      await service.upload('demo-room','note.txt','text/plain',Buffer.from('stable'));
      const [persona]=(await repositories.personas.list('demo-room')),round=await repositories.messages.createRound('demo-room','no changes',[persona],new Map([[persona.id,profile]])),run=round.runs[0];
      const before=(await repositories.database.sql`SELECT COUNT(*)::int snapshots FROM workspace_snapshots`)[0]!.snapshots;
      const currentBefore=(await repositories.workspaceSnapshots.current('demo-room'))!.id;
      await repositories.database.sql`UPDATE workspace_snapshots SET manifest_sha256='legacy-placeholder' WHERE id=${currentBefore}`;
      await service.prepareRun('demo-room',run.id);
      const result=await finalizeRun(repositories,service,run.id,'completed');
      const after=(await repositories.database.sql`SELECT COUNT(*)::int snapshots FROM workspace_snapshots`)[0]!.snapshots;
      expect(result).toMatchObject({capture_status:'complete',publish_status:'noop',base_snapshot_id:currentBefore,result_snapshot_id:currentBefore});
      expect(result?.published_snapshot_id).toBeUndefined();
      expect(after).toBe(before);
      expect((await repositories.workspaceSnapshots.current('demo-room'))!.id).toBe(currentBefore);
      expect((await repositories.database.sql`SELECT manifest_sha256 FROM workspace_snapshots WHERE id=${currentBefore}`)[0]?.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Number((await repositories.database.sql`SELECT COUNT(*) count FROM workspace_snapshots WHERE source_run_id=${run.id}`)[0]?.count)).toBe(0);
      expect(Number((await repositories.database.sql`SELECT COUNT(*) count FROM run_artifacts WHERE run_id=${run.id}`)[0]?.count)).toBe(0);
      expect(Number((await repositories.database.sql`SELECT COUNT(*) count FROM workspace_publish_conflicts WHERE run_id=${run.id}`)[0]?.count)).toBe(0);
      expect((await repositories.database.sql`SELECT cleanup_status FROM run_workspace_results WHERE run_id=${run.id}`)[0]?.cleanup_status).toBe('complete');
      expect(await stat(path.dirname(service.runPath('demo-room',run.id))).then(()=>true).catch(()=>false)).toBe(false);
      for(const terminal of ['failed','cancelled'] as const){
        const unchanged=(await repositories.messages.createRound('demo-room',`no changes ${terminal}`,[persona],new Map([[persona.id,profile]]))).runs[0];
        await service.prepareRun('demo-room',unchanged.id);
        expect(await finalizeRun(repositories,service,unchanged.id,terminal)).toMatchObject({capture_status:'complete',publish_status:'noop',result_snapshot_id:currentBefore});
      }
      expect((await repositories.database.sql`SELECT COUNT(*)::int snapshots FROM workspace_snapshots`)[0]!.snapshots).toBe(before);
    }finally{service.close();await repositories.database.close()}
  });

  it('never takes the no-op path when capture reports a reserved path',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'noop-error-'));roots.push(root);
    const repositories=await createRepositories(testDatabaseUrl('noop_capture_error'));
    const service=new RoomWorkspaceService(repositories.rooms,repositories.workspace,new RoomEventService(repositories.roomEvents,new RoomEventBus()),new ActiveRunRegistry(),root,root,1024*1024,true,repositories.workspaceSnapshots,undefined,{noopMode:'on'},repositories.workspaceSlots);
    try{
      const [persona]=(await repositories.personas.list('demo-room')),run=(await repositories.messages.createRound('demo-room','reserved path',[persona],new Map([[persona.id,profile]]))).runs[0];
      await service.prepareRun('demo-room',run.id);
      await mkdir(path.join(service.runPath('demo-room',run.id),'.agenvyl'));
      const result=await finalizeRun(repositories,service,run.id,'completed');
      expect(result).toMatchObject({capture_status:'incomplete',publish_status:'not_published'});
      expect(result?.errors).toContainEqual({path:'.agenvyl',code:'reserved'});
      expect(result?.result_snapshot_id).not.toBe(result?.base_snapshot_id);
    }finally{service.close();await repositories.database.close()}
  });

  it('retains a finalized workspace until the owning agent run is durably terminal',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'terminal-cleanup-fence-'));roots.push(root);
    const repositories=await createRepositories(testDatabaseUrl('terminal_cleanup_fence'));
    const service=new RoomWorkspaceService(repositories.rooms,repositories.workspace,new RoomEventService(repositories.roomEvents,new RoomEventBus()),new ActiveRunRegistry(),root,root,1024*1024,true,repositories.workspaceSnapshots,undefined,{noopMode:'on'},repositories.workspaceSlots);
    try{
      const [persona]=(await repositories.personas.list('demo-room')),run=(await repositories.messages.createRound('demo-room','terminal cleanup fence',[persona],new Map([[persona.id,profile]]))).runs[0];
      await service.prepareRun('demo-room',run.id);
      expect((await service.finalizeRun('demo-room',run.id,'completed'))?.publish_status).toBe('noop');
      expect(await stat(path.dirname(service.runPath('demo-room',run.id))).then(()=>true).catch(()=>false)).toBe(true);
      expect((await repositories.database.sql`SELECT cleanup_status FROM run_workspace_results WHERE run_id=${run.id}`)[0]?.cleanup_status).toBe('pending');
      await repositories.database.sql`UPDATE agent_runs SET status='completed' WHERE id=${run.id}`;
      await service.cleanupFinalizedRun('demo-room',run.id);
      expect(await stat(path.dirname(service.runPath('demo-room',run.id))).then(()=>true).catch(()=>false)).toBe(false);
    }finally{service.close();await repositories.database.close()}
  });

  it('uses two fenced warm slots and falls back to a legacy directory for a third same-persona run',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'warm-slots-'));roots.push(root);
    const repositories=await createRepositories(testDatabaseUrl('warm_slot_pool'));
    const service=new RoomWorkspaceService(repositories.rooms,repositories.workspace,new RoomEventService(repositories.roomEvents,new RoomEventBus()),new ActiveRunRegistry(),root,root,1024*1024,true,repositories.workspaceSnapshots,undefined,{noopMode:'on',warmSlotsMode:'on'},repositories.workspaceSlots);
    try{
      const [persona]=(await repositories.personas.list('demo-room')),profiles=new Map([[persona.id,profile]]);
      const rounds=await Promise.all(['one','two','three'].map(text=>repositories.messages.createRound('demo-room',text,[persona],profiles)));
      const runs=rounds.map(round=>round.runs[0]);
      const prepared=await Promise.all(runs.map(run=>service.prepareRun('demo-room',run.id)));
      expect(prepared.filter(item=>item.relativePath.includes('/agents/'))).toHaveLength(2);
      expect(prepared.filter(item=>item.relativePath.includes('/runs/'))).toHaveLength(1);
      const rows=await repositories.database.sql`SELECT workspace_driver,workspace_slot_generation FROM run_workspace_results WHERE run_id=ANY(${runs.map(run=>run.id)}) ORDER BY workspace_driver`;
      expect(rows.filter(row=>row.workspace_driver==='warm')).toHaveLength(2);
      expect(rows.filter(row=>row.workspace_driver==='legacy')).toHaveLength(1);
      const ownersBefore=new Set((await repositories.database.sql`SELECT owner_run_id FROM workspace_slots WHERE owner_run_id IS NOT NULL`).map(row=>row.owner_run_id));
      await repositories.database.sql`UPDATE workspace_slots SET lease_expires_at=now()-interval '1 minute' WHERE owner_run_id IS NOT NULL`;
      const fourth=(await repositories.messages.createRound('demo-room','expired leases do not steal',[persona],profiles)).runs[0],fourthPath=await service.prepareRun('demo-room',fourth.id);
      expect(fourthPath.relativePath).toContain('/runs/');
      expect(new Set((await repositories.database.sql`SELECT owner_run_id FROM workspace_slots WHERE owner_run_id IS NOT NULL`).map(row=>row.owner_run_id))).toEqual(ownersBefore);
      await Promise.all([...runs,fourth].map(run=>finalizeRun(repositories,service,run.id,'failed')));
      expect((await repositories.database.sql`SELECT COUNT(*)::int count FROM workspace_slots WHERE owner_run_id IS NOT NULL`)[0]?.count).toBe(0);
    }finally{service.close();await repositories.database.close()}
  });

  it('keeps the legacy driver authoritative while warm slots run in shadow mode',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'warm-slot-shadow-'));roots.push(root);
    const repositories=await createRepositories(testDatabaseUrl('warm_slot_shadow'));
    const service=new RoomWorkspaceService(repositories.rooms,repositories.workspace,new RoomEventService(repositories.roomEvents,new RoomEventBus()),new ActiveRunRegistry(),root,root,1024*1024,true,repositories.workspaceSnapshots,undefined,{noopMode:'shadow',warmSlotsMode:'shadow'},repositories.workspaceSlots);
    try{
      await service.upload('demo-room','value.txt','text/plain',Buffer.from('base'));
      const [persona]=(await repositories.personas.list('demo-room')),run=(await repositories.messages.createRound('demo-room','shadow slot',[persona],new Map([[persona.id,profile]]))).runs[0];
      const prepared=await service.prepareRun('demo-room',run.id);
      expect(prepared.relativePath).toContain('/runs/');
      expect((await repositories.database.sql`SELECT workspace_driver,workspace_slot_id FROM run_workspace_results WHERE run_id=${run.id}`)[0]).toMatchObject({workspace_driver:'legacy',workspace_slot_id:null});
      expect(await repositories.workspaceSlots.leaseForRun(run.id)).toBeDefined();
      await writeFile(path.join(prepared.absolutePath,'value.txt'),'next');
      expect((await finalizeRun(repositories,service,run.id,'completed'))?.publish_status).toBe('published');
      expect(await repositories.workspaceSlots.leaseForRun(run.id)).toBeUndefined();
    }finally{service.close();await repositories.database.close()}
  });

  it('ignores a stale slot release after the slot generation has advanced',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'warm-slot-fence-'));roots.push(root);
    const repositories=await createRepositories(testDatabaseUrl('warm_slot_generation_fence'));
    const service=new RoomWorkspaceService(repositories.rooms,repositories.workspace,new RoomEventService(repositories.roomEvents,new RoomEventBus()),new ActiveRunRegistry(),root,root,1024*1024,true,repositories.workspaceSnapshots,undefined,{noopMode:'on',warmSlotsMode:'on'},repositories.workspaceSlots);
    try{
      const [persona]=(await repositories.personas.list('demo-room')),profiles=new Map([[persona.id,profile]]);
      const first=(await repositories.messages.createRound('demo-room','first lease',[persona],profiles)).runs[0];
      await service.prepareRun('demo-room',first.id);
      const firstLease=await repositories.workspaceSlots.leaseForRun(first.id);
      expect(firstLease).toBeDefined();
      await finalizeRun(repositories,service,first.id,'completed');

      const second=(await repositories.messages.createRound('demo-room','second lease',[persona],profiles)).runs[0];
      await service.prepareRun('demo-room',second.id);
      const secondLease=await repositories.workspaceSlots.leaseForRun(second.id);
      expect(secondLease).toMatchObject({id:firstLease!.id,generation:firstLease!.generation+1});

      expect(await repositories.workspaceSlots.release(first.id,firstLease!.generation,firstLease!.materializedSnapshotId!)).toBe(false);
      const owner=(await repositories.database.sql`SELECT owner_run_id,generation FROM workspace_slots WHERE id=${secondLease!.id}`)[0];
      expect(owner?.owner_run_id).toBe(second.id);
      expect(Number(owner?.generation)).toBe(secondLease!.generation);
      await finalizeRun(repositories,service,second.id,'completed');
    }finally{service.close();await repositories.database.close()}
  });

  it('detects a same-size rewrite even when mtime is restored with stat cache enabled',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'stat-cache-'));roots.push(root);
    const repositories=await createRepositories(testDatabaseUrl('stat_cache_racy'));
    const service=new RoomWorkspaceService(repositories.rooms,repositories.workspace,new RoomEventService(repositories.roomEvents,new RoomEventBus()),new ActiveRunRegistry(),root,root,1024*1024,true,repositories.workspaceSnapshots,undefined,{noopMode:'on',warmSlotsMode:'on',statCacheMode:'on'},repositories.workspaceSlots);
    try{
      await service.upload('demo-room','value.txt','text/plain',Buffer.from('alpha'));
      const [persona]=(await repositories.personas.list('demo-room')),profiles=new Map([[persona.id,profile]]);
      const first=(await repositories.messages.createRound('demo-room','prime cache',[persona],profiles)).runs[0];
      await service.prepareRun('demo-room',first.id);
      expect((await finalizeRun(repositories,service,first.id,'completed'))?.publish_status).toBe('noop');
      const second=(await repositories.messages.createRound('demo-room','rewrite',[persona],profiles)).runs[0],prepared=await service.prepareRun('demo-room',second.id);
      const file=path.join(prepared.absolutePath,'value.txt'),original=await stat(file);
      await writeFile(file,'omega');
      await utimes(file,original.atime,original.mtime);
      const result=await finalizeRun(repositories,service,second.id,'completed');
      expect(result?.publish_status).toBe('published');
      expect(await readFile(path.join(root,'demo-room','value.txt'),'utf8')).toBe('omega');
    }finally{service.close();await repositories.database.close()}
  });
});
