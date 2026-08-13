import {describe,expect,it,vi} from 'vitest';
import {ActiveRunRegistry} from './ActiveRunRegistry.js';
import {RunInterventionService} from './RunInterventionService.js';

const input={intervention_id:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'Focus on the API'};

describe('RunInterventionService',()=>{
  it('registers an idempotent redirect only for a streaming run',async()=>{
    const activeRuns=new ActiveRunRegistry(),intervene=vi.fn(async()=>({status:'pending' as const,checkpoint:{executionId:'run-1',connectorEpoch:'epoch',cursor:3}}));
    activeRuns.add({id:'run-1',roomId:'room',messageId:'message',personaVersionId:'version',requestedModel:'model',harnessInstanceId:'local-codex',harnessType:'codex',modelId:'model',executionProfile:{} as never,conversationHistory:[],connectorExecutionId:'execution-1',status:'streaming',terminal:false} as never);
    const service=new RunInterventionService({runs:{control:vi.fn(async()=>({id:'run-1',status:'streaming'}))} as never,activeRuns,gateway:{intervene} as never});
    await expect(service.create('run-1',input)).resolves.toEqual({mode:'active_redirect',intervention_id:input.intervention_id,status:'pending'});
    await expect(service.create('run-1',input)).resolves.toEqual({mode:'active_redirect',intervention_id:input.intervention_id,status:'pending'});
    expect(intervene).toHaveBeenCalledOnce();
    await expect(service.create('run-1',{...input,text:'Different'})).rejects.toMatchObject({code:'intervention_conflict',statusCode:409});
  });

  it('rejects missing, non-streaming, waiting, and unsupported runs',async()=>{
    const activeRuns=new ActiveRunRegistry(),control=vi.fn(async(id:string)=>id==='missing'?undefined:{id:'run-1',status:'queued'});
    let service=new RunInterventionService({runs:{control} as never,activeRuns,gateway:{} as never});
    await expect(service.create('missing',input)).rejects.toMatchObject({code:'not_found',statusCode:404});
    activeRuns.add({id:'run-1',status:'streaming',terminal:false,pendingRequests:new Map([['request',{id:'request'}]])} as never);control.mockResolvedValue({id:'run-1',status:'streaming'});
    await expect(service.create('run-1',input)).rejects.toMatchObject({code:'run_waiting_for_user',statusCode:409});
    activeRuns.add({id:'run-1',status:'streaming',terminal:false,pendingRequests:new Map(),connectorExecutionId:'execution-1'} as never);
    service=new RunInterventionService({runs:{control} as never,activeRuns,gateway:{} as never});
    await expect(service.create('run-1',input)).rejects.toMatchObject({code:'intervention_unsupported',statusCode:409});
  });

  it('creates an idempotent native child with no replayed history',async()=>{
    const activeRuns=new ActiveRunRegistry(),event={id:'event',event_id:'event',sequence:8,type:'run.created',payload:{}};
    const created={status:'created' as const,runId:'child',sourceRunId:'source',roomId:'room',messageId:'message',responseSlotId:'slot',personaVersionId:'version',personaHandle:'coder',requestedModel:'model',harnessInstanceId:'local-codex',harnessType:'codex',modelId:'model',executionProfile:{},history:[],text:'Tighten the answer',continuationHandle:'opaque',systemPrompt:'snapshot',event};
    const runs={control:vi.fn(async()=>({id:'source',room_id:'room',harness_instance_id:'local-codex',harness_type:'codex',status:'completed'})),createContinuation:vi.fn(async()=>created)},events={publishPersisted:vi.fn()},executor={start:vi.fn()},cleanup={reconcile:vi.fn()},harnesses={currentInstance:vi.fn(async()=>({id:'local-codex',type:'codex',postTurnContinuation:{mode:'native_session',durability:'connector_restart',retention:'explicit_release'}}))};
    const service=new RunInterventionService({runs,activeRuns,gateway:{} as never,harnesses,events,executor,cleanup} as never);
    await expect(service.create('source',{intervention_id:input.intervention_id,text:' Tighten the answer '})).resolves.toEqual({mode:'post_turn_continuation',intervention_id:input.intervention_id,run_id:'child',continued_from_run_id:'source'});
    expect(activeRuns.get('child')).toMatchObject({continuedFromRunId:'source',continuationHandle:'opaque',conversationHistory:[],refreshContext:false,systemPromptSnapshot:'snapshot'});
    expect(executor.start).toHaveBeenCalledWith('child','Tighten the answer');
  });
});
