import type {ActiveRunRegistry} from '../runs/ActiveRunRegistry.js';
import type {RunExecutor} from '../runs/RunExecutor.js';
import type {RunRepository} from '../runs/runs.repository.js';
import type {RoomEventService} from '../room-events/RoomEventService.js';
import type {HarnessCatalogService} from '../connector/HarnessCatalogService.js';
import type {MessageRepository} from './messages.repository.js';
import type {FollowUpRepository,PendingFollowUp} from './FollowUpRepository.js';
import {stableSessionId} from '../runs/stableSessionId.js';

export class FollowUpDispatcher{
  private readonly dispatching=new Set<string>();
  constructor(private readonly dependencies:{followUps:FollowUpRepository;runs:RunRepository;messages:MessageRepository;events:RoomEventService;harnesses:HarnessCatalogService;activeRuns:ActiveRunRegistry;executor:RunExecutor}){}

  async recover(){for(const item of await this.dependencies.followUps.recoverable()){if(item.deliveryKind==='apply_now'){const reset=await this.dependencies.followUps.requeueApplyNow(item.id);if(reset)this.dependencies.events.publishPersisted(reset.roomId,reset.event);if(reset)await this.dispatch(reset.item);continue}await this.dispatch(item);}}
  async onRunTerminal(runId:string){for(const item of await this.dependencies.followUps.pendingForAnchor(runId))await this.dispatch(item);}
  async dispatchById(id:string){const item=await this.dependencies.followUps.get(id);if(item)await this.dispatch(item);}

  private async dispatch(item:PendingFollowUp){
    if(this.dispatching.has(item.id)||item.deliveryKind!=='after_response')return;
    const source=await this.dependencies.runs.control(item.anchorRunId);
    if(!source||!['completed','failed','cancelled'].includes(source.status))return;
    this.dispatching.add(item.id);
    try{
      const dispatching=await this.dependencies.followUps.markDelivery(item.id,'dispatching');
      if(dispatching)this.dependencies.events.publishPersisted(dispatching.roomId,dispatching.event);
      let native=false;
      if(source.status==='completed'){
        try{
          const instance=await this.dependencies.harnesses.currentInstance(source.harness_instance_id,source.harness_type);
          const capability=instance?.status!=='unavailable'?instance?.postTurnContinuation:undefined;
          if(capability?.mode==='native_session')native=await this.startNative(item,capability.retention);
        }catch{/* A fresh room-history run is the safe fallback when session discovery fails. */}
      }
      if(!native)await this.startFallback(item);
    }catch(error){
      const failed=await this.dependencies.followUps.markDelivery(item.id,'failed',{error:error instanceof Error?error.message:String(error),final:true});
      if(failed)this.dependencies.events.publishPersisted(failed.roomId,failed.event);
    }finally{this.dispatching.delete(item.id);}
  }

  private async startNative(item:PendingFollowUp,retention:'explicit_release'|'provider_managed'){
    const created=await this.dependencies.runs.createFollowUpContinuation(item.id,retention);
    if(created.status!=='created')return created.status==='duplicate';
    this.dependencies.activeRuns.add({id:created.runId,messageId:created.messageId,roomId:created.roomId,personaVersionId:created.personaVersionId,personaHandle:created.personaHandle,requestedModel:created.requestedModel,harnessInstanceId:created.harnessInstanceId,harnessType:created.harnessType,modelId:created.modelId,executionProfile:created.executionProfile,recommendedProject:created.recommendedProject,conversationHistory:[],sessionId:stableSessionId(created.roomId,created.runId),terminal:false,started:false,refreshContext:false,continuedFromRunId:created.sourceRunId,continuationHandle:created.continuationHandle,systemPromptSnapshot:created.systemPrompt});
    this.dependencies.events.publishPersisted(created.roomId,created.runEvent);
    this.dependencies.events.publishPersisted(created.roomId,created.deliveryEvent);
    this.dependencies.executor.start(created.runId,created.text);
    return true;
  }

  private async startFallback(item:PendingFollowUp){
    const context=await this.dependencies.messages.conversationContextForRun(item.roomId,item.personaHandle,item.messageId);
    const created=await this.dependencies.followUps.createHistoryFallback(item.id,context.history);
    if(created.status!=='created')return;
    this.dependencies.activeRuns.add({id:created.runId,messageId:created.messageId,roomId:created.roomId,personaVersionId:created.personaVersionId,personaHandle:created.personaHandle,requestedModel:created.requestedModel,harnessInstanceId:created.harnessInstanceId,harnessType:created.harnessType,modelId:created.modelId,executionProfile:created.executionProfile,recommendedProject:created.recommendedProject,conversationHistory:created.history,terminal:false,started:false,refreshContext:true});
    this.dependencies.events.publishPersisted(created.roomId,created.runEvent);
    this.dependencies.events.publishPersisted(created.roomId,created.deliveryEvent);
    this.dependencies.executor.start(created.runId,created.text);
  }
}
