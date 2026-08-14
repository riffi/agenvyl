import type {CreateMessageRequest,MessageRouting} from '@agenvyl/contracts';
import {parseMentions} from '../../routing.js';
import {AppError} from '../../shared/errors/AppError.js';
import type {PersonaRepository} from '../personas/personas.repository.js';
import type {RoomEventService} from '../room-events/RoomEventService.js';
import type {RunInterventionService} from '../runs/RunInterventionService.js';
import type {CreateMessageRound} from './createMessageRound.js';
import type {FollowUpDispatcher} from './FollowUpDispatcher.js';
import type {FollowUpAnchor,FollowUpRepository} from './FollowUpRepository.js';
import type {MessageRepository} from './messages.repository.js';

export class ConversationRoutingService{
  private readonly applyingNow=new Set<string>();
  constructor(private readonly dependencies:{legacy:CreateMessageRound;followUps:FollowUpRepository;dispatcher:FollowUpDispatcher;personas:PersonaRepository;events:RoomEventService;interventions:RunInterventionService;messages:MessageRepository}){}

  async execute(command:{roomId:string;body:CreateMessageRequest;correlationId?:string}){
    const text=command.body.text?.trim()??'',messageId=command.body.message_id??crypto.randomUUID();
    if(!text&&!command.body.attachment_version_ids?.length)throw new AppError('text_required',400,'Message text or attachment is required');
    if(!/^[0-9a-f-]{36}$/i.test(messageId))throw new AppError('invalid_message_id',400,'Invalid message ID');
    const existing=await this.dependencies.messages.find(command.roomId,messageId);
    if(existing)return{status:'duplicate' as const,message:existing};
    const personas=await this.dependencies.personas.list(command.roomId),handles=personas.map(item=>item.handle);
    const mentioned=command.body.targets??parseMentions(text,handles),unique=[...new Set(mentioned)];
    const roomMode=await this.dependencies.followUps.roomMode(command.roomId);
    if(!roomMode)throw new AppError('room_not_found',404,'Room not found');
    const routing:MessageRouting=command.body.routing??{mode:roomMode};
    if(routing.mode==='room_context'||(routing.mode==='auto'&&routing.delivery==='new_request')||unique.length>1)return this.legacy(command,routing.target?[routing.target]:unique,messageId);
    if(routing.mode==='auto'){
      if(unique.length===1){
        const current=await this.dependencies.followUps.anchors(command.roomId);
        if(current.length!==1||current[0].personaHandle!==unique[0])return this.legacy(command,unique,messageId);
        return this.agentSession(command,current[0],routing.delivery==='apply_now'?'apply_now':'after_response',messageId);
      }
      const current=await this.dependencies.followUps.anchors(command.roomId);
      if(current.length===0)return this.legacy(command,[],messageId);
      if(current.length>1)throw new AppError('routing_target_required',409,'Auto found several possible recipients. Mention one agent or use @all');
      return this.agentSession(command,current[0],routing.delivery==='apply_now'?'apply_now':'after_response',messageId);
    }
    const requested=routing.target??(unique.length===1?unique[0]:undefined);
    const anchors=await this.dependencies.followUps.anchors(command.roomId,requested);
    if(!anchors.length)throw new AppError('session_unavailable',409,requested?`No agent session is available for @${requested}`:'No agent session is available');
    if(anchors.length>1)throw new AppError('routing_target_required',409,'Choose an agent before sending this message');
    return this.agentSession(command,anchors[0],routing.delivery??'after_response',messageId);
  }

  async applyQueuedNow(command:{roomId:string;messageId:string}){
    if(this.applyingNow.has(command.messageId))return this.existingMessage(command.roomId,command.messageId,'duplicate');
    this.applyingNow.add(command.messageId);
    try{
      const claim=await this.dependencies.followUps.claimApplyNow(command.roomId,command.messageId);
      if(claim.status==='not_found')throw new AppError('queued_message_not_found',404,'Queued message not found');
      if(claim.status==='unavailable')throw new AppError('queued_message_unavailable',409,'This message is no longer waiting for the agent');
      if(claim.status==='anchor_not_streaming'){
        await this.dependencies.dispatcher.dispatchById(claim.pendingId);
        throw new AppError('run_not_intervenable',409,'The response ended before the message could be applied');
      }
      if(claim.status==='already_applied')return this.existingMessage(command.roomId,command.messageId,'duplicate');
      if(claim.status==='claimed')this.dependencies.events.publishPersisted(command.roomId,claim.event);
      let interventionAccepted=false;
      try{
        await this.dependencies.interventions.applyNow(claim.item.anchorRunId,{intervention_id:command.messageId,text:claim.item.text});
        interventionAccepted=true;
        const applied=await this.dependencies.followUps.markDelivery(claim.item.id,'applied',{route:'active_intervention',final:true});
        if(applied)this.dependencies.events.publishPersisted(applied.roomId,applied.event);
      }catch(error){
        if(!interventionAccepted){
          const reset=await this.dependencies.followUps.requeueApplyNow(claim.item.id);
          if(reset)this.dependencies.events.publishPersisted(reset.roomId,reset.event);
          await this.dependencies.dispatcher.dispatchById(claim.item.id);
        }
        throw error;
      }
      return this.existingMessage(command.roomId,command.messageId,'created');
    }finally{this.applyingNow.delete(command.messageId);}
  }

  private legacy(command:{roomId:string;body:CreateMessageRequest;correlationId?:string},targets:string[],messageId:string){
    return this.dependencies.legacy.execute({roomId:command.roomId,text:command.body.text,targets,attachmentVersionIds:command.body.attachment_version_ids,messageId,correlationId:command.correlationId,delivery:{route:'room_context',status:'delivered'}});
  }

  private async existingMessage(roomId:string,messageId:string,status:'created'|'duplicate'){
    const message=await this.dependencies.messages.find(roomId,messageId);
    if(!message)throw new AppError('queued_message_not_found',404,'Queued message not found');
    return{status,message};
  }

  private async agentSession(command:{roomId:string;body:CreateMessageRequest},anchor:FollowUpAnchor,delivery:'after_response'|'apply_now',messageId:string){
    if(command.body.attachment_version_ids?.length)throw new AppError('agent_session_attachments_unsupported',409,'Attachments require Room context');
    if(delivery==='apply_now'&&anchor.status!=='streaming')throw new AppError('run_not_intervenable',409,'Apply now is available only while the agent is actively responding');
    const created=await this.dependencies.followUps.create({roomId:command.roomId,text:command.body.text?.trim()??'',messageId,anchor,deliveryKind:delivery});
    if(created.status==='duplicate')return{status:'duplicate' as const,message:created.message};
    if(created.status==='already_queued')throw new AppError('follow_up_already_queued',409,`A follow-up for @${anchor.personaHandle} is already waiting`,{messageId:created.messageId});
    if(created.status==='room_not_found')throw new AppError('room_not_found',404,'Room not found');
    if(created.status==='anchor_unavailable')throw new AppError('session_unavailable',409,'The selected agent session is no longer available');
    this.dependencies.events.publishPersisted(command.roomId,created.event);
    if(delivery==='apply_now'){
      try{
        // Reuse the visible room message id so the timeline can render this as one
        // ordinary user message while the run still receives a native intervention.
        await this.dependencies.interventions.applyNow(anchor.runId,{intervention_id:messageId,text:created.message.text});
        const applied=await this.dependencies.followUps.markDelivery(created.pendingId,'applied',{route:'active_intervention',final:true});
        if(applied)this.dependencies.events.publishPersisted(applied.roomId,applied.event);
      }catch(error){
        const failed=await this.dependencies.followUps.markDelivery(created.pendingId,'failed',{route:'active_intervention',error:error instanceof Error?error.message:String(error),final:true});
        if(failed)this.dependencies.events.publishPersisted(failed.roomId,failed.event);
        throw error;
      }
    }else if(['completed','failed','cancelled'].includes(created.anchorStatus))await this.dependencies.dispatcher.dispatchById(created.pendingId);
    return{status:'created' as const,message:(await this.dependencies.messages.find(command.roomId,messageId))??created.message};
  }
}
