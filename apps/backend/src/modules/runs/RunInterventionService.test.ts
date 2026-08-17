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

  it('forwards attachments when applying a queued message immediately',async()=>{
    const activeRuns=new ActiveRunRegistry(),intervene=vi.fn(async()=>({status:'pending' as const})),attachment={versionId:'version-1',name:'screen.png',mimeType:'image/png',size:42,sha256:'a'.repeat(64)};
    activeRuns.add({id:'run-1',roomId:'room',messageId:'message',connectorExecutionId:'execution-1',status:'streaming',terminal:false} as never);
    const service=new RunInterventionService({runs:{control:vi.fn(async()=>({id:'run-1',status:'streaming'}))} as never,activeRuns,gateway:{intervene} as never});
    await service.applyNow('run-1',{...input,attachments:[attachment]});
    expect(intervene).toHaveBeenCalledWith('execution-1',{interventionId:input.intervention_id,text:input.text,attachments:[attachment]});
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

  it('creates a fresh queued message and cancels an active run when workflow mode changed',async()=>{
    const activeRuns=new ActiveRunRegistry(),event={id:'event',event_id:'event',sequence:8,type:'message.created',payload:{}};
    activeRuns.add({id:'source',roomId:'room',messageId:'message',personaVersionId:'version',requestedModel:'model',harnessInstanceId:'local-codex',harnessType:'codex',modelId:'model',executionProfile:{workflowMode:'plan'},conversationHistory:[],connectorExecutionId:'execution-1',status:'streaming',terminal:false} as never);
    const control={id:'source',room_id:'room',persona_id:'persona',persona_handle:'coder',harness_instance_id:'local-codex',harness_type:'codex',execution_profile:{workflowMode:'plan'},status:'streaming'};
    const followUps={create:vi.fn(async(args:{resolveProfile:(source:never,mode:'work')=>unknown})=>{expect(args.resolveProfile(control.execution_profile as never,'work')).toMatchObject({workflowMode:'work',planEnforcement:null});return{status:'created' as const,pendingId:'pending',event,transitionReason:'workflow_mode_changed' as const};}),markDelivery:vi.fn(async()=>({roomId:'room',event:{...event,id:'stopping'}})),recordQueuedError:vi.fn()};
    const executor={cancel:vi.fn(async()=>({status:'stopping'}))},events={publishPersisted:vi.fn()},dispatchFollowUp=vi.fn(async()=>undefined),harnesses={catalog:vi.fn(async()=>({instances:[{id:'local-codex',type:'codex',status:'healthy',controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[],agentVariants:[]}}]}))};
    const service=new RunInterventionService({runs:{control:vi.fn(async()=>control)} as never,activeRuns,gateway:{intervene:vi.fn()} as never,harnesses:harnesses as never,events:events as never,executor:executor as never,cleanup:{} as never,followUps:followUps as never,dispatchFollowUp});
    await expect(service.create('source',input)).resolves.toEqual({mode:'workflow_handoff',intervention_id:input.intervention_id,message_id:input.intervention_id,source_run_id:'source',status:'queued'});
    expect(executor.cancel).toHaveBeenCalledWith('source');
    expect(followUps.markDelivery).toHaveBeenCalledWith('pending','dispatching',{route:'agent_session'});
    expect(dispatchFollowUp).not.toHaveBeenCalled();
  });

  it('keeps a failed workflow handoff queued when stopping the active run fails',async()=>{
    const event={id:'event',event_id:'event',sequence:8,type:'message.created',payload:{}},control={id:'source',room_id:'room',persona_id:'persona',persona_handle:'coder',harness_instance_id:'local-codex',harness_type:'codex',execution_profile:{workflowMode:'plan'},status:'streaming'},queuedEvent={id:'queued',event_id:'queued',sequence:9,type:'message.delivery.updated',payload:{}};
    const followUps={create:vi.fn(async()=>({status:'created' as const,pendingId:'pending',event,transitionReason:'workflow_mode_changed' as const})),markDelivery:vi.fn(async()=>({roomId:'room',event:{...event,id:'stopping'}})),recordQueuedError:vi.fn(async()=>({roomId:'room',event:queuedEvent}))},executor={cancel:vi.fn(async()=>{throw new Error('stop unavailable')})},events={publishPersisted:vi.fn()},harnesses={catalog:vi.fn(async()=>({instances:[{id:'local-codex',type:'codex',status:'healthy',controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[],agentVariants:[]}}]}))};
    const service=new RunInterventionService({runs:{control:vi.fn(async()=>control)} as never,activeRuns:new ActiveRunRegistry(),gateway:{} as never,harnesses:harnesses as never,events:events as never,executor:executor as never,cleanup:{} as never,followUps:followUps as never,dispatchFollowUp:vi.fn()});
    await expect(service.create('source',input)).rejects.toThrow('stop unavailable');
    expect(followUps.recordQueuedError).toHaveBeenCalledWith('pending','stop unavailable');
    expect(events.publishPersisted).toHaveBeenLastCalledWith('room',queuedEvent);
  });

  it('starts a fresh workflow handoff immediately after a completed run',async()=>{
    const event={id:'event',event_id:'event',sequence:8,type:'message.created',payload:{}},control={id:'source',room_id:'room',persona_id:'persona',persona_handle:'coder',harness_instance_id:'local-codex',harness_type:'codex',execution_profile:{workflowMode:'work'},status:'completed'},dispatchFollowUp=vi.fn(async()=>undefined);
    const followUps={create:vi.fn(async()=>({status:'created' as const,pendingId:'pending',event,transitionReason:'workflow_mode_changed' as const})),markDelivery:vi.fn()},harnesses={catalog:vi.fn(async()=>({instances:[{id:'local-codex',type:'codex',status:'healthy',controls:{nativeWorkflowModes:['plan'],permissionProfiles:[],agentVariants:[]}}]}))};
    const service=new RunInterventionService({runs:{control:vi.fn(async()=>control)} as never,activeRuns:new ActiveRunRegistry(),gateway:{} as never,harnesses:harnesses as never,events:{publishPersisted:vi.fn()} as never,executor:{} as never,cleanup:{} as never,followUps:followUps as never,dispatchFollowUp});
    await expect(service.create('source',input)).resolves.toEqual({mode:'workflow_handoff',intervention_id:input.intervention_id,message_id:input.intervention_id,source_run_id:'source',status:'started'});
    expect(dispatchFollowUp).toHaveBeenCalledWith('pending');
  });
});
