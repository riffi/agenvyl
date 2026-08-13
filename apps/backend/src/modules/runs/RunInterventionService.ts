import type {CreateRunInterventionResult} from '@agenvyl/contracts';
import type {RunGateway} from '../harness/harness.ports.js';
import type {HarnessCatalogService} from '../connector/HarnessCatalogService.js';
import {AppError} from '../../shared/errors/AppError.js';
import type {ActiveRunRegistry} from './ActiveRunRegistry.js';
import type {RunRepository} from './runs.repository.js';
import type {RoomEventService} from '../room-events/RoomEventService.js';
import type {RunExecutor} from './RunExecutor.js';
import {stableSessionId} from './stableSessionId.js';
import type {RunContinuationCleanupService} from './RunContinuationCleanupService.js';

type Dependencies={runs:RunRepository;activeRuns:ActiveRunRegistry;gateway:RunGateway;harnesses:HarnessCatalogService;events:RoomEventService;executor:RunExecutor;cleanup:RunContinuationCleanupService};

export class RunInterventionService{
  constructor(private readonly dependencies:Dependencies){}

  async create(runId:string,input:{intervention_id:string;text:string}):Promise<CreateRunInterventionResult>{
    const text=input.text.trim(),control=await this.dependencies.runs.control(runId);
    if(!control)throw new AppError('not_found',404,'Run not found');
    const active=this.dependencies.activeRuns.get(runId);
    if(active&&!active.terminal&&control.status==='streaming'&&active.status==='streaming'){
      const redirected=await this.redirectActive(active,input.intervention_id,text);
      if(redirected)return redirected;
      // Connector can observe the terminal transition before Core has consumed it.
      // Re-check the same intervention id against the durable post-turn path.
      for(let attempt=0;attempt<10;attempt++){
        const latest=await this.dependencies.runs.control(runId);
        if(latest?.status==='completed')break;
        if(latest&&['failed','cancelled'].includes(latest.status))break;
        await new Promise<void>(resolve=>setTimeout(resolve,25));
      }
    }
    return this.continueCompleted(runId,input.intervention_id,text);
  }

  private async redirectActive(run:NonNullable<ReturnType<ActiveRunRegistry['get']>>,interventionId:string,text:string):Promise<CreateRunInterventionResult|undefined>{
    if(run.pendingRequests?.size)throw new AppError('run_waiting_for_user',409,'Resolve the pending agent request before adding an instruction');
    if(run.pendingIntervention){
      if(run.pendingIntervention.id===interventionId&&run.pendingIntervention.text===text)return{mode:'active_redirect',intervention_id:interventionId,status:'pending'};
      throw new AppError(run.pendingIntervention.id===interventionId?'intervention_conflict':'intervention_in_progress',409,run.pendingIntervention.id===interventionId?'Intervention ID is already used with different text':'Another instruction is already in progress');
    }
    if(!this.dependencies.gateway.intervene)throw new AppError('intervention_unsupported',409,'This harness does not support adding instructions to active runs');
    const executionId=run.connectorExecutionId??run.upstreamRunId;
    if(!executionId)return undefined;
    try{
      const result=await this.dependencies.gateway.intervene(executionId,{interventionId,text});
      if(result.status==='pending')run.pendingIntervention={id:interventionId,text};
      return{mode:'active_redirect',intervention_id:interventionId,status:'pending'};
    }catch(error){
      const issue=error as {code?:unknown;status?:unknown;serverCode?:unknown;message?:unknown};
      if(issue.code==='connector_command_rejected'&&(issue.serverCode==='execution_terminal'||issue.serverCode==='execution_not_intervenable'))return undefined;
      if(issue.code==='connector_command_rejected')throw new AppError(typeof issue.serverCode==='string'?issue.serverCode:'intervention_rejected',typeof issue.status==='number'?issue.status:409,typeof issue.message==='string'?issue.message:'Connector rejected the instruction');
      throw error;
    }
  }

  private async continueCompleted(runId:string,interventionId:string,text:string):Promise<CreateRunInterventionResult>{
    const control=await this.dependencies.runs.control(runId);
    if(!control)throw new AppError('not_found',404,'Run not found');
    if(control.status!=='completed')throw new AppError('run_not_intervenable',409,'Instructions can be added only while streaming or after a successful selected response');
    const instance=await this.dependencies.harnesses.currentInstance(control.harness_instance_id,control.harness_type);
    const capability=instance?.postTurnContinuation;
    if(!capability||capability.mode!=='native_session'||instance?.status==='unavailable')throw new AppError('continuation_unavailable',409,'This harness instance does not support post-turn continuation');
    const created=await this.dependencies.runs.createContinuation(runId,{interventionId,text,retention:capability.retention});
    if(created.status==='not_found')throw new AppError('not_found',404,'Run not found');
    if(created.status==='not_completed')throw new AppError('run_not_intervenable',409,'Post-turn continuation requires a completed run');
    if(created.status==='selection_changed')throw new AppError('selection_changed',409,'The response selection changed after this run completed');
    if(created.status==='continuation_active')throw new AppError('continuation_in_progress',409,'A continuation is already running');
    if(created.status==='continuation_unavailable')throw new AppError('continuation_unavailable',409,'The completed run has no native continuation handle');
    if(created.status==='continuation_incompatible')throw new AppError('continuation_incompatible',409,'The current harness configuration is incompatible with this continuation');
    if(created.status==='intervention_conflict')throw new AppError('intervention_conflict',409,'Intervention ID is already used with different input');
    if(created.status==='conversation_advanced'){await this.dependencies.cleanup.reconcile();throw new AppError('conversation_advanced',409,'The conversation changed after this response completed');}
    if(created.status==='duplicate')return{mode:'post_turn_continuation',intervention_id:interventionId,run_id:created.runId,continued_from_run_id:runId};
    this.dependencies.activeRuns.add({id:created.runId,messageId:created.messageId,roomId:created.roomId,personaVersionId:created.personaVersionId,personaHandle:created.personaHandle,requestedModel:created.requestedModel,harnessInstanceId:created.harnessInstanceId,harnessType:created.harnessType,modelId:created.modelId,executionProfile:created.executionProfile,recommendedProject:created.recommendedProject,conversationHistory:[],sessionId:stableSessionId(created.roomId,created.runId),terminal:false,started:false,refreshContext:false,continuedFromRunId:runId,continuationHandle:created.continuationHandle,systemPromptSnapshot:created.systemPrompt});
    this.dependencies.events.publishPersisted(created.roomId,created.event);
    this.dependencies.executor.start(created.runId,created.text);
    return{mode:'post_turn_continuation',intervention_id:interventionId,run_id:created.runId,continued_from_run_id:runId};
  }
}
