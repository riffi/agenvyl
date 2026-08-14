import {describe,expect,it,vi} from 'vitest';
import {ConversationRoutingService} from './ConversationRoutingService.js';

const persona={id:'persona-coder',handle:'coder',name:'Coder',color:'#64748b',requested_model:'sol',effective_model:null,harness_instance_id:'local-codex',harness_type:'codex',model_id:'sol',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,current_version_id:'persona-coder-v1',group_id:null,archived_at:null};
const author={profileId:'local-user',displayName:'User',handle:'user'};
const message={id:'11111111-1111-4111-8111-111111111111',text:'Continue',createdAt:'2026-08-14T00:00:00.000Z',targets:['coder'],runIds:[],attachments:[],author,addressedToAll:false,delivery:{route:'agent_session' as const,status:'queued' as const,agent:'coder',anchorRunId:'run-1'}};

function fixture(anchors=[{runId:'run-1',roomId:'room',personaId:'persona-coder',personaHandle:'coder',status:'streaming'}]){
  const legacy={execute:vi.fn(async()=>({status:'created' as const,message:{...message,delivery:{route:'room_context' as const,status:'delivered' as const}}}))};
  const followUps={roomMode:vi.fn(async()=> 'auto' as const),anchors:vi.fn(async()=>anchors),create:vi.fn(async()=>({status:'created' as const,pendingId:'pending-1',message,event:{id:'event-1',sequence:1,type:'message.created',payload:message},anchorStatus:anchors[0]?.status??'completed'})),claimApplyNow:vi.fn(),requeueApplyNow:vi.fn(),markDelivery:vi.fn(),get:vi.fn()};
  const dispatcher={dispatchById:vi.fn(async()=>undefined)},events={publishPersisted:vi.fn()},interventions={applyNow:vi.fn()},messages={find:vi.fn(async():Promise<typeof message|undefined>=>undefined)};
  const service=new ConversationRoutingService({legacy:legacy as never,followUps:followUps as never,dispatcher:dispatcher as never,personas:{list:vi.fn(async()=>[persona])} as never,events:events as never,interventions:interventions as never,messages:messages as never});
  return{service,legacy,followUps,dispatcher,interventions,messages};
}

describe('ConversationRoutingService',()=>{
  it('queues an unmentioned Auto message behind the one clear active agent',async()=>{
    const{service,followUps}=fixture();
    const result=await service.execute({roomId:'room',body:{text:'Continue',message_id:message.id}});
    expect(result.status).toBe('created');
    expect(followUps.create).toHaveBeenCalledWith(expect.objectContaining({anchor:expect.objectContaining({runId:'run-1'}),deliveryKind:'after_response'}));
  });

  it('requires a target when Auto has multiple plausible agents',async()=>{
    const{service}=fixture([{runId:'run-1',roomId:'room',personaId:'p1',personaHandle:'coder',status:'streaming'},{runId:'run-2',roomId:'room',personaId:'p2',personaHandle:'reviewer',status:'streaming'}]);
    await expect(service.execute({roomId:'room',body:{text:'Continue',message_id:message.id}})).rejects.toMatchObject({code:'routing_target_required',statusCode:409});
  });

  it('keeps an explicit Room context request on the legacy tail path',async()=>{
    const{service,legacy,followUps}=fixture();
    await service.execute({roomId:'room',body:{text:'@coder start fresh',message_id:message.id,routing:{mode:'room_context'}}});
    expect(legacy.execute).toHaveBeenCalledWith(expect.objectContaining({targets:['coder']}));
    expect(followUps.create).not.toHaveBeenCalled();
  });

  it('applies an urgent correction with the visible message id',async()=>{
    const{service,interventions}=fixture();
    await service.execute({roomId:'room',body:{text:'Continue',message_id:message.id,routing:{mode:'agent_session',target:'coder',delivery:'apply_now'}}});
    expect(interventions.applyNow).toHaveBeenCalledWith('run-1',{intervention_id:message.id,text:'Continue'});
  });

  it('promotes an existing queued message to an active intervention',async()=>{
    const{service,followUps,interventions,dispatcher,messages}=fixture();
    messages.find.mockResolvedValue(message);
    followUps.claimApplyNow.mockResolvedValue({status:'claimed',item:{id:'pending-1',roomId:'room',messageId:message.id,personaId:'persona-coder',personaHandle:'coder',anchorRunId:'run-1',deliveryKind:'apply_now',status:'dispatching',text:'Continue'},event:{id:'event-claim',sequence:2,type:'message.delivery.updated',payload:{}},delivery:{route:'active_intervention',status:'dispatching'}});
    followUps.markDelivery.mockResolvedValue({roomId:'room',event:{id:'event-applied',sequence:3,type:'message.delivery.updated',payload:{}}});
    const result=await service.applyQueuedNow({roomId:'room',messageId:message.id});
    expect(interventions.applyNow).toHaveBeenCalledWith('run-1',{intervention_id:message.id,text:'Continue'});
    expect(followUps.markDelivery).toHaveBeenCalledWith('pending-1','applied',{route:'active_intervention',final:true});
    expect(dispatcher.dispatchById).not.toHaveBeenCalled();
    expect(result.status).toBe('created');
  });

  it('keeps the message queued when immediate application fails',async()=>{
    const{service,followUps,interventions,dispatcher}=fixture();
    followUps.claimApplyNow.mockResolvedValue({status:'claimed',item:{id:'pending-1',roomId:'room',messageId:message.id,personaId:'persona-coder',personaHandle:'coder',anchorRunId:'run-1',deliveryKind:'apply_now',status:'dispatching',text:'Continue'},event:{id:'event-claim',sequence:2,type:'message.delivery.updated',payload:{}},delivery:{route:'active_intervention',status:'dispatching'}});
    followUps.requeueApplyNow.mockResolvedValue({roomId:'room',item:{id:'pending-1',roomId:'room',messageId:message.id,personaId:'persona-coder',personaHandle:'coder',anchorRunId:'run-1',deliveryKind:'after_response',status:'queued',text:'Continue'},event:{id:'event-reset',sequence:3,type:'message.delivery.updated',payload:{}}});
    interventions.applyNow.mockRejectedValue(new Error('unsupported'));
    await expect(service.applyQueuedNow({roomId:'room',messageId:message.id})).rejects.toThrow('unsupported');
    expect(followUps.requeueApplyNow).toHaveBeenCalledWith('pending-1');
    expect(dispatcher.dispatchById).toHaveBeenCalledWith('pending-1');
  });
});
