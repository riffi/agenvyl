import {mkdtemp,rm,stat,writeFile} from 'node:fs/promises';
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

describe('isolated run workspace snapshots',()=>{
  it('gives parallel runs separate cwd, captures exact manifests, and exposes a three-way conflict',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'run-snapshots-'));roots.push(root);
    const repositories=await createRepositories(testDatabaseUrl('isolated_run_snapshots'));
    const events=new RoomEventService(repositories.roomEvents,new RoomEventBus()),service=new RoomWorkspaceService(repositories.rooms,repositories.workspace,events,new ActiveRunRegistry(),root,root,1024*1024,true,repositories.workspaceSnapshots);
    try{
      await service.upload('demo-room','site/index.html','text/html',Buffer.from('<link rel="stylesheet" href="style.css">'));
      await service.upload('demo-room','site/style.css','text/css',Buffer.from('body{color:black}'));
      const personas=(await repositories.personas.list('demo-room')).slice(0,2),profiles=new Map(personas.map(persona=>[persona.id,profile]));
      const round=await repositories.messages.createRound('demo-room','parallel edit',personas,profiles);
      const [first,second]=round.runs;
      const [firstWorkspace,secondWorkspace]=await Promise.all([service.prepareRun('demo-room',first.id),service.prepareRun('demo-room',second.id)]);
      expect(firstWorkspace.absolutePath).not.toBe(secondWorkspace.absolutePath);
      await Promise.all([
        writeFile(path.join(service.runPath('demo-room',first.id),'site','style.css'),'body{color:red}'),
        writeFile(path.join(service.runPath('demo-room',second.id),'site','style.css'),'body{color:blue}'),
      ]);
      const firstResult=await service.finalizeRun('demo-room',first.id,'completed'),secondResult=await service.finalizeRun('demo-room',second.id,'completed');
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
      const result=await service.finalizeRun('demo-room',run.id,'failed');
      expect(result).toMatchObject({capture_status:'complete',publish_status:'not_published'});
      expect(await stat(path.dirname(service.runPath('demo-room',run.id))).then(()=>true).catch(()=>false)).toBe(false);
      expect(await repositories.workspace.currentVersion('demo-room','draft.txt')).toBeUndefined();
      expect(await service.resolveSnapshotFile('demo-room',result!.result_snapshot_id!,'draft.txt')).toMatchObject({contentType:'text/plain'});
    }finally{service.close();await repositories.database.close()}
  });
});
