import type {RoomEventService} from '../room-events/RoomEventService.js';
import {AppError} from '../../shared/errors/AppError.js';
import type {ActiveRunRegistry} from './ActiveRunRegistry.js';
import type {RunExecutor} from './RunExecutor.js';
import type {RunRepository} from './runs.repository.js';
import {stableSessionId} from './stableSessionId.js';

export class RunsService{
  constructor(private readonly dependencies:{runs:RunRepository;events:RoomEventService;activeRuns:ActiveRunRegistry;executor:RunExecutor}){}
  cancel(id:string){return this.dependencies.executor.cancel(id);}
  async approve(id:string,resolution?:string){await this.dependencies.executor.approve(id,resolution);return{status:'accepted'};}
  async retry(id:string,correlationId?:string){const{runs,events,activeRuns,executor}=this.dependencies,retried=await runs.retry(id);if(retried.status==='not_found')throw new AppError('not_found',404,'Run not found');if(retried.status==='not_retryable')throw new AppError('run_not_retryable',409,'A new attempt is available only after the current run finishes');if(retried.status==='conversation_advanced')throw new AppError('conversation_advanced',409,'The conversation has already continued. Create a branch from this message to retry the earlier run');if(retried.status==='retry_active')throw new AppError('retry_active',409,'A retry is already running');if(retried.status==='invalid_retry_route')throw new AppError('invalid_retry_route',409,'The saved AGY configuration is invalid. Select plan or accept-edits in the agent settings');activeRuns.add({id:retried.runId,messageId:retried.messageId,roomId:retried.roomId,personaVersionId:retried.personaVersionId,requestedModel:retried.requestedModel,harnessInstanceId:retried.harnessInstanceId,harnessType:retried.harnessType,modelId:retried.modelId,modeId:retried.modeId,conversationHistory:retried.history,sessionId:stableSessionId(retried.roomId,retried.runId),correlationId,terminal:false,started:false,refreshContext:false});events.publishPersisted(retried.roomId,retried.event);executor.start(retried.runId,retried.text);return{run_id:retried.runId,retry_of_run_id:id};}
  async select(id:string){const{runs,events}=this.dependencies,selected=await runs.select(id);if(selected.status==='not_found')throw new AppError('not_found',404,'Run not found');if(selected.status==='not_completed')throw new AppError('run_not_completed',409,'Only a completed attempt can be selected as the final response');if(selected.status==='conversation_advanced')throw new AppError('conversation_advanced',409,'The next conversation turn has already fixed the previous round’s result');await events.emit(selected.roomId,'run.selected',{responseSlotId:selected.slotId,runId:selected.runId});return{status:'selected'};}
}
