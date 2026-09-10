import {execFile} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {describe,expect,it,vi} from 'vitest';
import Fastify from 'fastify';
import {registerErrorHandler} from '../../app/plugins/errorHandler.js';
import {registerWorkspaceRoutes} from './workspace.routes.js';
import {RunExecutor} from '../runs/RunExecutor.js';
import type {StartRunInput} from '../harness/harness.ports.js';
import {createRepositories} from '../../infrastructure/database/createRepositories.js';
import {testDatabaseUrl} from '../../testDatabase.js';
import {RoomEventBus} from '../room-events/RoomEventBus.js';
import {RoomEventService} from '../room-events/RoomEventService.js';
import {ActiveRunRegistry} from '../runs/ActiveRunRegistry.js';
import {PreviewBundleStore} from './PreviewBundleStore.js';
import {RoomWorkspaceService} from './RoomWorkspaceService.js';
import {GitWorkspaceRestore} from './GitWorkspaceRestore.js';

const execute=promisify(execFile);
const profile={workflowMode:'work' as const,requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto' as const,planEnforcement:null,permissionProfileId:null,agentVariantId:null};
const fixture=async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'workspace-restore-')),repositories=await createRepositories(testDatabaseUrl('workspace_restore'));
  const events=new RoomEventService(repositories.roomEvents,new RoomEventBus()),active=new ActiveRunRegistry();
  const create=()=>new RoomWorkspaceService(repositories.rooms,repositories.workspace,repositories.runWorkspaces,events,active,root,root,1024*1024,undefined,new PreviewBundleStore(path.join(root,'artifacts'),10*1024*1024));
  const service=create(),roomRoot=await service.ensure('demo-room'),persona=(await repositories.personas.find('persona-architect'))!;
  const git=async(...args:string[])=>(await execute('git',['-C',roomRoot,...args],{windowsHide:true})).stdout.trim();
  const write=(file:string,content:string|Buffer)=>writeFile(path.join(roomRoot,file),content);
  const run=async(change:()=>Promise<unknown>,status:'completed'|'failed'|'cancelled'='completed')=>{
    const round=await repositories.messages.createRound('demo-room','Make changes',[persona],new Map([[persona.id,profile]])),id=round.runs[0]!.id;
    await service.prepareRun('demo-room',id);await change();await service.finalizeRun('demo-room',id,status);await events.emit('demo-room','run.status',{runId:id,status});return id;
  };
  const restore=async(id:string,kind:'run'|'restore'='run')=>{
    const preview=await service.restores.preview('demo-room',{kind,id}),request={target:preview.target,fingerprint:preview.fingerprint,requestId:crypto.randomUUID()};
    return{preview,request,result:await service.restores.execute('demo-room',request)};
  };
  return{root,roomRoot,repositories,service,create,events,active,git,write,run,restore,close:async()=>{await repositories.database.close();await rm(root,{recursive:true,force:true});}};
};

describe('workspace restoration',()=>{
  it('restores a run boundary with a saved preview, preserves history, and reverses the rollback including dirty files',async()=>{
    const f=await fixture();
    try{
      const first=await f.run(async()=>{await mkdir(path.join(f.roomRoot,'dist'));await f.write('package.json','{}');await f.write('source.txt','first');await f.write('binary.bin',Buffer.from([0,1,255]));await f.write('dist/index.html','first build');});
      const oldVersion=(await f.repositories.workspace.currentVersion('demo-room','source.txt'))!;
      const bad=await f.run(async()=>{await f.write('source.txt','second');await f.git('add','-A');await f.git('-c','user.name=Agent','-c','user.email=agent@local','commit','-m','intermediate');await rename(path.join(f.roomRoot,'binary.bin'),path.join(f.roomRoot,'renamed.bin'));await f.write('source.txt','third');await f.write('dist/index.html','bad build');},'failed');
      const later=await f.run(()=>f.write('later.txt','later'),'cancelled');
      await f.write('source.txt','manual change');await f.write('manual.txt','new manual file');await f.write('.env','preserve secret');
      const oldHead=await f.git('rev-parse','HEAD'),{preview,request,result}=await f.restore(bad);
      expect(preview.savesUncommittedChanges).toBe(true);
      expect(preview.affectedRuns.map(run=>run.id)).toEqual(expect.arrayContaining([bad,later]));
      expect(preview.changes).toEqual(expect.arrayContaining([{path:'binary.bin',change:'created'},{path:'renamed.bin',change:'deleted'},{path:'manual.txt',change:'deleted'}]));
      expect(await readFile(path.join(f.roomRoot,'source.txt'),'utf8')).toBe('first');
      await expect(readFile(path.join(f.roomRoot,'manual.txt'))).rejects.toMatchObject({code:'ENOENT'});
      await expect(readFile(path.join(f.roomRoot,'later.txt'))).rejects.toMatchObject({code:'ENOENT'});
      expect(await readFile(path.join(f.roomRoot,'binary.bin'))).toEqual(Buffer.from([0,1,255]));
      expect(await readFile(path.join(f.roomRoot,'.env'),'utf8')).toBe('preserve secret');
      expect(await readFile(path.join(f.roomRoot,'dist/index.html'),'utf8')).toBe('bad build');
      expect(await f.git('rev-parse',`${result.resultHead}^`)).toBe(result.beforeHead);
      expect(await f.git('rev-parse',`${result.beforeHead}^`)).toBe(oldHead);
      expect(await f.git('diff',result.targetHead,'HEAD')).toBe('');
      expect((await f.service.list('demo-room')).staticPreview).toMatchObject({status:'ready',runId:first});
      expect((await f.service.resolveRunPreview('demo-room',bad)).data.toString()).toBe('bad build');
      expect((await f.service.version('demo-room',oldVersion.id)).sha256).toBe(oldVersion.sha256);
      expect(await f.service.restores.execute('demo-room',request)).toEqual(result);
      const timeline=await f.repositories.rooms.timeline('demo-room',undefined,30);
      expect(timeline?.workspaceRestorations).toHaveLength(1);
      expect(await f.service.restores.context('demo-room')).toContain('Re-read the current files');
      await f.restore(result.id,'restore');
      expect(await readFile(path.join(f.roomRoot,'source.txt'),'utf8')).toBe('manual change');
      expect(await readFile(path.join(f.roomRoot,'manual.txt'),'utf8')).toBe('new manual file');
      expect((await f.service.list('demo-room')).staticPreview).toEqual({status:'build_missing'});
      expect((await f.service.restores.history('demo-room')).items.filter(item=>item.kind==='restore')).toHaveLength(2);
    }finally{await f.close();}
  },45_000);

  it('rejects stale confirmations, preserved-path collisions, unavailable commits, and active runs',async()=>{
    const f=await fixture();
    try{
      await f.run(()=>f.write('file.txt','base'));
      const run=await f.run(()=>f.write('file.txt','changed'));
      const preview=await f.service.restores.preview('demo-room',{kind:'run',id:run});
      await f.write('file.txt','external');
      await expect(f.service.restores.execute('demo-room',{target:preview.target,fingerprint:preview.fingerprint,requestId:crypto.randomUUID()})).rejects.toMatchObject({code:'workspace_restore_stale'});
      expect(await readFile(path.join(f.roomRoot,'file.txt'),'utf8')).toBe('external');
      const activeSpy=vi.spyOn(f.active,'values').mockImplementation(()=>new Map([['active',{roomId:'demo-room',started:true,terminal:false}]]).values() as ReturnType<ActiveRunRegistry['values']>);
      await expect(f.service.restores.preview('demo-room',preview.target)).rejects.toMatchObject({code:'workspace_writer_active'});
      activeSpy.mockImplementation(()=>new Map([['active',{roomId:'demo-room',started:true,terminal:true}]]).values() as ReturnType<ActiveRunRegistry['values']>);
      await expect(f.service.restores.preview('demo-room',preview.target)).rejects.toMatchObject({code:'workspace_writer_active'});activeSpy.mockRestore();
      await f.run(async()=>{await rm(path.join(f.roomRoot,'file.txt'));await f.write('.gitignore','file.txt\n.agenvyl/\n');});
      await f.write('file.txt','ignored data');
      await expect(f.service.restores.preview('demo-room',preview.target)).rejects.toMatchObject({code:'workspace_restore_conflict'});
      expect(await readFile(path.join(f.roomRoot,'file.txt'),'utf8')).toBe('ignored data');
      await f.repositories.database.sql`UPDATE run_workspace_results SET base_head=${'f'.repeat(40)} WHERE run_id=${run}`;
      expect((await f.service.restores.history('demo-room')).items.find(item=>item.id===run)?.unavailableReason).toBe('The saved Git checkpoint is unavailable.');
      await expect(f.service.restores.preview('demo-room',preview.target)).rejects.toMatchObject({code:'workspace_restore_conflict'});
      await f.write('.git/MERGE_HEAD','unfinished');
      await expect(f.service.restores.preview('demo-room',preview.target)).rejects.toThrow('unfinished');
    }finally{await f.close();}
  },30_000);

  it('leaves generated output intact when it was explicitly tracked in Git',async()=>{
    const f=await fixture();
    try{
      await f.run(()=>f.write('source.txt','base'));
      const bad=await f.run(async()=>{await mkdir(path.join(f.roomRoot,'dist'));await f.write('dist/index.html','tracked output');await f.git('add','-f','dist/index.html');await f.write('source.txt','bad');});
      const head=await f.git('rev-parse','HEAD');
      await expect(f.service.restores.preview('demo-room',{kind:'run',id:bad})).rejects.toThrow('Generated output is tracked in Git');
      expect(await readFile(path.join(f.roomRoot,'dist/index.html'),'utf8')).toBe('tracked output');
      expect(await f.git('rev-parse','HEAD')).toBe(head);
      expect(await f.repositories.workspace.restores.pending('demo-room')).toEqual([]);
    }finally{await f.close();}
  },30_000);

  it('preserves ignored files when restoring an older .gitignore exposes them',async()=>{
    const f=await fixture();
    try{
      await f.run(()=>f.write('source.txt','base'));
      const bad=await f.run(async()=>{
        await f.write('.gitignore',`${await readFile(path.join(f.roomRoot,'.gitignore'),'utf8')}\nkeep.local\n`);
        await f.write('keep.local','preserve local data');await f.write('source.txt','bad');
      });
      const {result}=await f.restore(bad);
      expect(result.status).toBe('complete');
      expect(await readFile(path.join(f.roomRoot,'keep.local'),'utf8')).toBe('preserve local data');
      expect(await readFile(path.join(f.roomRoot,'source.txt'),'utf8')).toBe('base');
      expect(await f.git('ls-files','keep.local')).toBe('');
      expect(await f.repositories.workspace.restores.pending('demo-room')).toEqual([]);
    }finally{await f.close();}
  },30_000);

  it('does not publish leftover output as a fresh build after restoration',async()=>{
    const f=await fixture();
    try{
      await f.run(async()=>{await mkdir(path.join(f.roomRoot,'dist'));await f.write('package.json','{}');await f.write('src.txt','one');await f.write('dist/index.html','one');});
      const bad=await f.run(async()=>{await f.write('src.txt','two');await f.write('dist/index.html','two');});
      await f.restore(bad);
      const rebuiltOnly=await f.run(()=>f.write('dist/index.html','rebuilt without source edits'));
      expect((await f.service.list('demo-room')).staticPreview).toMatchObject({status:'ready',runId:rebuiltOnly});
      await f.write('dist/index.html','two');
      const sourceOnly=await f.run(()=>f.write('src.txt','three'));
      expect(await f.repositories.workspace.previewBundleForRun('demo-room',sourceOnly)).toBeUndefined();
      const rebuilt=await f.run(async()=>{await f.write('src.txt','four');await f.write('dist/index.html','four');});
      expect((await f.service.list('demo-room')).staticPreview).toMatchObject({status:'ready',runId:rebuilt});
    }finally{await f.close();}
  },30_000);

  it('validates the API, isolates rooms, and replays execution without a duplicate restore',async()=>{
    const f=await fixture(),app=Fastify();
    try{
      await registerErrorHandler(app);await registerWorkspaceRoutes(app,f.service);
      const run=await f.run(()=>f.write('new.txt','new'));
      const base='/api/v1/rooms/demo-room/workspace',target={kind:'run',id:run};
      expect((await app.inject(`${base}/history`)).json().items.some((item:{id:string})=>item.id===run)).toBe(true);
      expect((await app.inject({method:'POST',url:`${base}/restores/preview`,payload:{target:{kind:'commit',id:'HEAD'}}})).statusCode).toBe(400);
      const other=await f.repositories.rooms.create('Other room',[]);
      expect((await app.inject({method:'POST',url:`/api/v1/rooms/${other.id}/workspace/restores/preview`,payload:{target}})).statusCode).toBe(404);
      const preview=(await app.inject({method:'POST',url:`${base}/restores/preview`,payload:{target}})).json();
      const payload={target,fingerprint:preview.fingerprint,requestId:crypto.randomUUID()};
      const response=await app.inject({method:'POST',url:`${base}/restores`,payload});
      expect(response.statusCode).toBe(200);expect(response.json().status).toBe('complete');
      expect((await app.inject({method:'POST',url:`${base}/restores`,payload})).json()).toEqual(response.json());
    }finally{await app.close();await f.close();}
  },30_000);

  it.each([false,true])('holds queued runs during recovery and sends the restored context (continuation=%s)',async(continuation)=>{
    const f=await fixture();let executor:RunExecutor|undefined;
    try{
      await f.run(()=>f.write('source.txt','base'));const bad=await f.run(()=>f.write('source.txt','bad'));
      const preview=await f.service.restores.preview('demo-room',{kind:'run',id:bad});
      const fail=vi.spyOn(GitWorkspaceRestore.prototype,'apply').mockRejectedValueOnce(new Error('interrupted'));
      await expect(f.service.restores.execute('demo-room',{target:preview.target,fingerprint:preview.fingerprint,requestId:crypto.randomUUID()})).rejects.toThrow('interrupted');fail.mockRestore();
      const persona=(await f.repositories.personas.find('persona-architect'))!,round=await f.repositories.messages.createRound('demo-room','continue',[persona],new Map([[persona.id,profile]])),id=round.runs[0]!.id;
      const createRun=vi.fn(async(input:StartRunInput)=>{expect(await readFile(path.join(f.roomRoot,'source.txt'),'utf8')).toBe('base');return{id:input.executionId};});
      executor=new RunExecutor({personas:f.repositories.personas,runs:f.repositories.runs,events:f.events,activeRuns:f.active,roomWorkspace:f.service,
        runGateway:{createRun,stop:async()=>{},approve:async()=>{}},runEvents:{async *stream(){yield{events:[],terminal:{status:'completed' as const}};}}});
      f.active.add({id,messageId:round.message.id,roomId:'demo-room',personaVersionId:'persona-architect-v1',requestedModel:'sol',harnessInstanceId:'local-hermes',harnessType:'hermes',modelId:'sol',executionProfile:profile,conversationHistory:[],terminal:false,refreshContext:false,
        ...(continuation?{continuedFromRunId:bad,continuationHandle:'native-session',systemPromptSnapshot:'Retained system prompt'}:{})});
      executor.start(id,'Continue');
      expect(createRun).not.toHaveBeenCalled();expect(f.active.get(id)?.started).not.toBe(true);
      const pending=(await f.repositories.workspace.restores.pending('demo-room'))[0]!;
      await f.service.restores.retry('demo-room',pending.id);
      await vi.waitFor(()=>expect(createRun).toHaveBeenCalledOnce(),{timeout:10_000});
      expect(createRun.mock.calls[0]![0].input).toContain('Re-read the current files');
      if(continuation)expect(createRun.mock.calls[0]![0]).toMatchObject({continuationHandle:'native-session',instructions:'Retained system prompt'});
      await vi.waitFor(()=>expect(f.active.get(id)).toBeUndefined(),{timeout:10_000});
    }finally{vi.restoreAllMocks();await executor?.shutdown();await f.close();}
  },30_000);

  it.each(['before-checkout','partial-checkout','after-checkout','after-commit'])('recovers an interrupted restore at %s exactly once',async(phase)=>{
    const f=await fixture();
    try{
      await f.run(async()=>{await f.write('source.txt','base');await f.write('deleted.txt','restore this file');});
      const bad=await f.run(async()=>{await f.write('source.txt','bad');await rm(path.join(f.roomRoot,'deleted.txt'));});
      const preview=await f.service.restores.preview('demo-room',{kind:'run',id:bad}),request={target:preview.target,fingerprint:preview.fingerprint,requestId:crypto.randomUUID()};
      const original=GitWorkspaceRestore.prototype.apply;
      const failure=phase==='after-commit'?vi.spyOn(f.repositories.workspace.restores,'complete').mockRejectedValueOnce(new Error('power loss')):
        vi.spyOn(GitWorkspaceRestore.prototype,'apply').mockImplementationOnce(async function(root,operation){
          if(phase==='partial-checkout')await f.write('deleted.txt','restore this file');
          if(phase==='after-checkout'){await original.call(this,root,operation);await f.git('update-ref',operation.branchRef,operation.beforeHead,operation.resultHead);}
          throw new Error('power loss');
        });
      await expect(f.service.restores.execute('demo-room',request)).rejects.toThrow('power loss');failure.mockRestore();
      await expect(f.service.upload('demo-room','new.txt','text/plain',Buffer.from('x'),'fail')).rejects.toMatchObject({code:'workspace_restore_pending'});
      const recovered=f.create();await recovered.recoverRuns();
      const result=await recovered.restores.execute('demo-room',request);
      expect(result.status).toBe('complete');expect(await readFile(path.join(f.roomRoot,'source.txt'),'utf8')).toBe('base');
      expect(await readFile(path.join(f.roomRoot,'deleted.txt'),'utf8')).toBe('restore this file');
      expect((await f.events.replay('demo-room',0)).filter(event=>event.type==='workspace.restored')).toHaveLength(1);
      expect(await f.git('rev-parse','HEAD')).toBe(result.resultHead);
    }finally{vi.restoreAllMocks();await f.close();}
  },30_000);
});
