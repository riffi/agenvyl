import {mkdir,mkdtemp,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {describe,expect,it} from 'vitest';
import {createRepositories} from '../../infrastructure/database/createRepositories.js';
import {testDatabaseUrl} from '../../testDatabase.js';
import {RoomEventBus} from '../room-events/RoomEventBus.js';
import {RoomEventService} from '../room-events/RoomEventService.js';
import {ActiveRunRegistry} from '../runs/ActiveRunRegistry.js';
import {PreviewBundleStore} from './PreviewBundleStore.js';
import {RoomWorkspaceService} from './RoomWorkspaceService.js';

const workProfile={workflowMode:'work' as const,requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto' as const,planEnforcement:null,permissionProfileId:null,agentVariantId:null};

describe('transparent Git workspace',()=>{
  it('runs directly in the room, captures once, and has no snapshot or run-directory tables',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'git-workspace-')),artifacts=await mkdtemp(path.join(tmpdir(),'git-artifacts-')),repositories=await createRepositories(testDatabaseUrl('direct_git_only'));
    const service=new RoomWorkspaceService(repositories.rooms,repositories.workspace,repositories.runWorkspaces,new RoomEventService(repositories.roomEvents,new RoomEventBus()),new ActiveRunRegistry(),root,root,1024*1024,undefined,new PreviewBundleStore(artifacts,10*1024*1024));
    try{
      const persona=(await repositories.personas.find('persona-architect'))!,round=await repositories.messages.createRound('demo-room','build it',[persona],new Map([[persona.id,workProfile]])),run=round.runs[0];
      const prepared=await service.prepareRun('demo-room',run.id);
      expect(prepared.relativePath).toBe('.');
      const roomRoot=path.join(root,'demo-room');
      await Promise.all([mkdir(path.join(roomRoot,'dist','assets'),{recursive:true}),mkdir(path.join(roomRoot,'node_modules','temporary'),{recursive:true})]);
      await Promise.all([writeFile(path.join(roomRoot,'src.ts'),'export const ready=true'),writeFile(path.join(roomRoot,'dist','index.html'),'<script src="assets/app.js"></script>'),writeFile(path.join(roomRoot,'dist','assets','app.js'),'window.ready=true'),writeFile(path.join(roomRoot,'node_modules','temporary','index.js'),'ignored')]);
      const liveWorkspace=await service.list('demo-room'),liveIndex=liveWorkspace.entries.find(entry=>entry.path==='dist/index.html');
      expect(liveIndex?.current_version_id).toMatch(/^live\./);
      expect(liveWorkspace.entries.some(entry=>entry.path.includes('node_modules'))).toBe(false);
      const result=await service.finalizeRun('demo-room',run.id,'completed');
      expect(result).toMatchObject({base_head:expect.any(String),result_head:expect.any(String),capture_status:'complete'});
      expect(await stat(path.join(roomRoot,'.agenvyl','runs')).then(()=>true).catch(()=>false)).toBe(false);
      expect(await repositories.database.sql`SELECT to_regclass('workspace_snapshots') snapshots,to_regclass('workspace_slots') slots`).toEqual([{snapshots:null,slots:null}]);
      expect((await repositories.database.sql`SELECT v.path FROM run_artifacts a JOIN workspace_versions v ON v.id=a.version_id WHERE a.run_id=${run.id}`).some(row=>String(row.path).includes('node_modules'))).toBe(false);
      const [immutableId]=await service.captureAttachmentVersions('demo-room',[liveIndex!.current_version_id!]);
      expect(immutableId).not.toMatch(/^live\./);
      expect((await service.resolveVersion('demo-room',immutableId!)).version.path).toBe('dist/index.html');
      const workspace=await service.list('demo-room');
      expect(workspace.staticPreview).toMatchObject({status:'ready',runId:run.id});
      expect((await service.resolveRunPreview('demo-room',run.id)).data.toString()).toContain('script');

      const planProfile={...workProfile,workflowMode:'plan' as const,planEnforcement:'native' as const},planRound=await repositories.messages.createRound('demo-room','plan it',[persona],new Map([[persona.id,planProfile]])),planRun=planRound.runs[0];
      await service.prepareRun('demo-room',planRun.id);
      const planResult=await service.finalizeRun('demo-room',planRun.id,'completed');
      expect(planResult).toMatchObject({base_head:planResult?.result_head,capture_status:'complete'});
      expect(await repositories.workspace.previewBundleForRun('demo-room',planRun.id)).toBeUndefined();
      expect((await service.list('demo-room')).previewHistory).toHaveLength(1);
    }finally{await repositories.database.close();await Promise.all([rm(root,{recursive:true,force:true}),rm(artifacts,{recursive:true,force:true})]);}
  });
});
