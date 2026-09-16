import {describe,expect,it} from 'vitest';
import {createRepositories} from '../../infrastructure/database/createRepositories.js';
import {testDatabaseUrl} from '../../testDatabase.js';

const profile={workflowMode:'work' as const,requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:null,agentVariantId:null};

describe('project changes and agent sessions',()=>{
  it.each(['switch','attach','detach','path','active'] as const)('starts fresh with room history after %s',async change=>{
    const p=await createRepositories(testDatabaseUrl('project_session'),{legacySeed:true});
    try{
      const first=await p.projects.create({name:'First',path:'C:/projects/first',pathKey:'c:/projects/first'});
      const second=await p.projects.create({name:'Second',path:'C:/projects/second',pathKey:'c:/projects/second'});
      if(change!=='attach')await p.rooms.assignProject('demo-room',first.id);
      const persona=(await p.personas.find('persona-architect'))!;
      const round=await p.messages.createRound('demo-room','Inspect the project',[persona],new Map([[persona.id,profile]]));
      const source=round.runs[0].id;
      await p.runs.setSystemPromptSnapshot(source,'Original project instructions');
      if(change!=='active'){
        await p.runs.finishNonTerminal(source,'completed',undefined,undefined,{handle:'old-session',retention:'explicit_release'});
        await p.runs.selectCompletedAttempt(source);
      }
      const [anchor]=await p.followUps.anchors('demo-room','architect');
      const queued=await p.followUps.create({roomId:'demo-room',text:'Continue',messageId:crypto.randomUUID(),anchor,deliveryKind:'after_response',resolveProfile:value=>value});
      if(queued.status!=='created')throw new Error('Expected queued follow-up');

      if(change==='path')await p.projects.update(first.id,{name:'First',path:second.path,pathKey:'c:/projects/moved'});
      else await p.rooms.assignProject('demo-room',change==='detach'?null:second.id);
      await expect(p.followUps.claimApplyNow('demo-room',queued.message.id)).resolves.toEqual({status:'project_changed'});
      if(change==='active'){
        expect((await p.runs.control(source))?.status).toBe('queued');
        await p.runs.finishNonTerminal(source,'completed',undefined,undefined,{handle:'finished-old-session',retention:'explicit_release'});
        await p.runs.selectCompletedAttempt(source);
      }
      await expect(p.followUps.create({roomId:'demo-room',text:'New message',messageId:crypto.randomUUID(),anchor,deliveryKind:'apply_now',resolveProfile:value=>value})).resolves.toEqual({status:'project_changed'});
      await expect(p.runs.createFollowUpContinuation(queued.pendingId,'explicit_release')).resolves.toEqual({status:'continuation_incompatible'});
      await expect(p.runs.createContinuation(source,{interventionId:crypto.randomUUID(),text:'Continue',retention:'explicit_release'})).resolves.toEqual({status:'continuation_incompatible'});

      const history=[{role:'user' as const,content:'Inspect the project'}];
      const fresh=await p.followUps.createHistoryFallback(queued.pendingId,history);
      if(fresh.status!=='created')throw new Error('Expected fresh history run');
      const expected=change==='detach'?undefined:{id:change==='path'?first.id:second.id,path:second.path,availability:'unknown'};
      if(expected)expect(fresh.recommendedProject).toMatchObject(expected);
      else expect(fresh.recommendedProject).toBeUndefined();
      expect(fresh.history).toEqual(history);
      const [saved]=await p.database.sql`SELECT project_id_snapshot,project_path_snapshot,continued_from_run_id,system_prompt_snapshot,context FROM agent_runs WHERE id=${fresh.runId}`;
      expect(saved).toMatchObject({project_id_snapshot:expected?.id??null,project_path_snapshot:expected?.path??null,continued_from_run_id:null,system_prompt_snapshot:null,context:history});
      expect(await p.runs.recommendedProject(source)).toEqual(change==='attach'?undefined:expect.objectContaining({id:first.id,path:first.path}));
      await expect(p.followUps.createHistoryFallback(queued.pendingId,history)).resolves.toMatchObject({status:'duplicate',runId:fresh.runId});
    }finally{await p.database.close();}
  });

  it('keeps sessions for the same project but invalidates switching away and back',async()=>{
    const p=await createRepositories(testDatabaseUrl('project_session_same'),{legacySeed:true});
    try{
      const project=await p.projects.create({name:'First',path:'C:/projects/first',pathKey:'c:/projects/first'});
      await p.rooms.assignProject('demo-room',project.id);
      const persona=(await p.personas.find('persona-architect'))!;
      const round=await p.messages.createRound('demo-room','Inspect',[persona],new Map([[persona.id,profile]])),source=round.runs[0].id;
      await p.runs.setSystemPromptSnapshot(source,'Original instructions');
      await p.runs.finishNonTerminal(source,'completed',undefined,undefined,{handle:'native-session',retention:'explicit_release'});
      await p.runs.selectCompletedAttempt(source);
      await p.rooms.assignProject('demo-room',project.id);
      const [chain]=await p.database.sql`SELECT invalidated_sequence,release_state FROM run_continuation_chains WHERE head_run_id=${source}`;
      expect(chain).toEqual({invalidated_sequence:null,release_state:'retained'});
      await p.rooms.assignProject('demo-room',null);
      await p.rooms.assignProject('demo-room',project.id);
      await expect(p.runs.createContinuation(source,{interventionId:crypto.randomUUID(),text:'Continue',retention:'explicit_release'})).resolves.toMatchObject({status:'conversation_advanced'});
    }finally{await p.database.close();}
  });
});
