import type {ConversationItem} from '../../types.js';
import type {Database} from '../../infrastructure/database/Database.js';
import {toMessage} from '../../infrastructure/database/rowMappers.js';
import type {MessageDelivery,RunExecutionProfileSnapshot,RunProjectSnapshot} from '@agenvyl/contracts';
import type {RoomEventRepository} from '../room-events/roomEvents.repository.js';

const nonTerminal=['queued','streaming','finalizing','stopping','waiting_approval','waiting_clarification'];

export type FollowUpAnchor={runId:string;roomId:string;personaId:string;personaHandle:string;status:string};
export type PendingFollowUp={id:string;roomId:string;messageId:string;personaId:string;personaHandle:string;anchorRunId:string;deliveryKind:'after_response'|'apply_now';status:string;text:string};

export class FollowUpRepository{
  constructor(private readonly database:Database,private readonly events:RoomEventRepository){}

  async roomMode(roomId:string){const[row]=await this.database.sql`SELECT conversation_routing_mode FROM rooms WHERE id=${roomId} AND deleted_at IS NULL`;return row?.conversation_routing_mode as import('@agenvyl/contracts').ConversationRoutingMode|undefined;}

  async anchors(roomId:string,target?:string):Promise<FollowUpAnchor[]>{
    const targetFilter=target??null;
    const active=await this.database.sql`SELECT DISTINCT ON(r.persona_id) r.id,r.room_id,r.persona_id,r.persona_handle,r.status,r.created_at FROM agent_runs r WHERE r.room_id=${roomId} AND r.status=ANY(${nonTerminal}) AND (${targetFilter}::text IS NULL OR r.persona_handle=${targetFilter}) ORDER BY r.persona_id,r.created_at DESC,r.id DESC`;
    if(active.length)return active.map(anchor);
    const selected=await this.database.sql`SELECT r.id,r.room_id,r.persona_id,r.persona_handle,r.status,r.created_at,m.id message_id FROM agent_runs r JOIN response_slots s ON s.selected_run_id=r.id JOIN room_messages m ON m.id=s.message_id WHERE r.room_id=${roomId} AND r.status='completed' AND (${targetFilter}::text IS NULL OR r.persona_handle=${targetFilter}) AND m.id=(SELECT m2.id FROM room_messages m2 JOIN response_slots s2 ON s2.message_id=m2.id AND s2.selected_run_id IS NOT NULL WHERE m2.room_id=${roomId} ORDER BY m2.created_at DESC,m2.id DESC LIMIT 1) ORDER BY r.created_at DESC,r.id DESC`;
    return selected.map(anchor);
  }

  async create(input:{roomId:string;text:string;messageId:string;anchor:FollowUpAnchor;deliveryKind:'after_response'|'apply_now'}){
    return this.database.transaction(async tx=>{
      const room=(await tx`SELECT id,title_source FROM rooms WHERE id=${input.roomId} AND deleted_at IS NULL FOR UPDATE`)[0];
      if(!room)return{status:'room_not_found' as const};
      const existing=(await tx`SELECT id,text,created_at,targets,run_ids,author_profile_id,author_display_name,author_handle,addressed_to_all,delivery_route,delivery_status,delivery_agent_handle,delivery_anchor_run_id,delivery_run_id,delivery_error FROM room_messages WHERE room_id=${input.roomId} AND id=${input.messageId}`)[0];
      if(existing)return{status:'duplicate' as const,message:toMessage(existing)};
      const pending=(await tx`SELECT message_id FROM pending_agent_follow_ups WHERE room_id=${input.roomId} AND persona_id=${input.anchor.personaId} AND status IN('queued','dispatching') LIMIT 1`)[0];
      if(pending)return{status:'already_queued' as const,messageId:String(pending.message_id)};
      const source=(await tx`SELECT id,status FROM agent_runs WHERE id=${input.anchor.runId} AND room_id=${input.roomId} AND persona_id=${input.anchor.personaId} FOR UPDATE`)[0];
      if(!source)return{status:'anchor_unavailable' as const};
      const authorRow=(await tx`SELECT id,display_name,handle FROM local_user_profiles WHERE id='local-user'`)[0];
      if(!authorRow)throw new Error('Local user profile is missing');
      const now=new Date().toISOString(),pendingId=crypto.randomUUID(),route=input.deliveryKind==='apply_now'?'active_intervention':'agent_session';
      const author={profileId:String(authorRow.id),displayName:String(authorRow.display_name),handle:String(authorRow.handle)};
      const delivery:MessageDelivery={route,status:'queued',agent:input.anchor.personaHandle,anchorRunId:input.anchor.runId};
      await tx`INSERT INTO room_messages(id,room_id,text,targets,run_ids,created_at,author_profile_id,author_display_name,author_handle,addressed_to_all,delivery_route,delivery_status,delivery_agent_handle,delivery_anchor_run_id,delivery_updated_at) VALUES(${input.messageId},${input.roomId},${input.text},${tx.json([input.anchor.personaHandle])},${tx.json([])},${now},${author.profileId},${author.displayName},${author.handle},false,${route},'queued',${input.anchor.personaHandle},${input.anchor.runId},${now})`;
      await tx`INSERT INTO pending_agent_follow_ups(id,room_id,message_id,persona_id,persona_handle,anchor_run_id,delivery_kind,status,created_at,updated_at) VALUES(${pendingId},${input.roomId},${input.messageId},${input.anchor.personaId},${input.anchor.personaHandle},${input.anchor.runId},${input.deliveryKind},'queued',${now},${now})`;
      const message={id:input.messageId,text:input.text,createdAt:now,targets:[input.anchor.personaHandle],runIds:[],attachments:[],author,addressedToAll:false,delivery};
      const event=await this.events.appendInTransaction(tx,input.roomId,'message.created',message,now);
      return{status:'created' as const,pendingId,message,event,anchorStatus:String(source.status)};
    });
  }

  async pendingForAnchor(anchorRunId:string){const rows=await this.database.sql`SELECT p.*,m.text FROM pending_agent_follow_ups p JOIN room_messages m ON m.id=p.message_id WHERE p.anchor_run_id=${anchorRunId} AND p.status IN('queued','dispatching') ORDER BY p.created_at`;return rows.map(pending);}
  async recoverable(){const rows=await this.database.sql`SELECT p.*,m.text FROM pending_agent_follow_ups p JOIN room_messages m ON m.id=p.message_id JOIN agent_runs r ON r.id=p.anchor_run_id WHERE p.status IN('queued','dispatching') AND r.status IN('completed','failed','cancelled') ORDER BY p.created_at`;return rows.map(pending);}
  async get(id:string){const[row]=await this.database.sql`SELECT p.*,m.text FROM pending_agent_follow_ups p JOIN room_messages m ON m.id=p.message_id WHERE p.id=${id}`;return row?pending(row):undefined;}

  async claimApplyNow(roomId:string,messageId:string){
    return this.database.transaction(async tx=>{
      const[row]=await tx`SELECT p.*,m.text,m.delivery_status,r.status anchor_status FROM pending_agent_follow_ups p JOIN room_messages m ON m.id=p.message_id JOIN agent_runs r ON r.id=p.anchor_run_id WHERE p.room_id=${roomId} AND p.message_id=${messageId} FOR UPDATE OF p,m,r`;
      if(!row)return{status:'not_found' as const};
      if(row.status==='delivered'&&row.delivery_status==='applied')return{status:'already_applied' as const};
      if(row.delivery_kind==='apply_now'&&row.status==='dispatching')return{status:'resume' as const,item:{...pending(row),deliveryKind:'apply_now' as const,status:'dispatching'}};
      if(row.delivery_kind!=='after_response'||row.status!=='queued')return{status:'unavailable' as const};
      if(row.anchor_status!=='streaming')return{status:'anchor_not_streaming' as const,pendingId:String(row.id)};
      const now=new Date().toISOString(),delivery:MessageDelivery={route:'active_intervention',status:'dispatching',agent:String(row.persona_handle),anchorRunId:String(row.anchor_run_id)};
      await tx`UPDATE pending_agent_follow_ups SET delivery_kind='apply_now',status='dispatching',claimed_at=COALESCE(claimed_at,${now}),updated_at=${now} WHERE id=${row.id as string}`;
      await tx`UPDATE room_messages SET delivery_route='active_intervention',delivery_status='dispatching',delivery_error=NULL,delivery_updated_at=${now} WHERE id=${messageId}`;
      const event=await this.events.appendInTransaction(tx,roomId,'message.delivery.updated',{messageId,delivery},now);
      return{status:'claimed' as const,item:{...pending(row),deliveryKind:'apply_now' as const,status:'dispatching'},event,delivery};
    });
  }

  async requeueApplyNow(id:string){
    return this.database.transaction(async tx=>{
      const[row]=await tx`SELECT p.*,m.text FROM pending_agent_follow_ups p JOIN room_messages m ON m.id=p.message_id WHERE p.id=${id} FOR UPDATE OF p,m`;
      if(!row||row.delivery_kind!=='apply_now'||row.status!=='dispatching')return undefined;
      const now=new Date().toISOString(),delivery:MessageDelivery={route:'agent_session',status:'queued',agent:String(row.persona_handle),anchorRunId:String(row.anchor_run_id)};
      await tx`UPDATE pending_agent_follow_ups SET delivery_kind='after_response',status='queued',claimed_at=NULL,updated_at=${now} WHERE id=${id}`;
      await tx`UPDATE room_messages SET delivery_route='agent_session',delivery_status='queued',delivery_error=NULL,delivery_updated_at=${now} WHERE id=${row.message_id as string}`;
      const event=await this.events.appendInTransaction(tx,String(row.room_id),'message.delivery.updated',{messageId:String(row.message_id),delivery},now);
      return{roomId:String(row.room_id),item:{...pending(row),deliveryKind:'after_response' as const,status:'queued'},event,delivery};
    });
  }

  async markDelivery(id:string,status:MessageDelivery['status'],options:{route?:MessageDelivery['route'];runId?:string;error?:string;final?:boolean}={}){
    return this.database.transaction(async tx=>{
      const[row]=await tx`SELECT p.*,m.delivery_route FROM pending_agent_follow_ups p JOIN room_messages m ON m.id=p.message_id WHERE p.id=${id} FOR UPDATE OF p,m`;
      if(!row)return undefined;
      const route=options.route??String(row.delivery_route) as MessageDelivery['route'],now=new Date().toISOString();
      await tx`UPDATE room_messages SET delivery_route=${route},delivery_status=${status},delivery_run_id=${options.runId??null},delivery_error=${options.error??null},delivery_updated_at=${now} WHERE id=${row.message_id as string}`;
      await tx`UPDATE pending_agent_follow_ups SET status=${options.final?(status==='failed'?'failed':'delivered'):'dispatching'},claimed_at=CASE WHEN ${status}='dispatching' THEN COALESCE(claimed_at,${now}) ELSE claimed_at END,updated_at=${now} WHERE id=${id}`;
      const delivery:MessageDelivery={route,status,agent:String(row.persona_handle),anchorRunId:String(row.anchor_run_id),...(options.runId?{runId:options.runId}:{}),...(options.error?{error:options.error}:{})};
      const event=await this.events.appendInTransaction(tx,String(row.room_id),'message.delivery.updated',{messageId:String(row.message_id),delivery},now);
      return{roomId:String(row.room_id),messageId:String(row.message_id),delivery,event};
    });
  }

  async createHistoryFallback(id:string,history:ConversationItem[]){
    return this.database.transaction(async tx=>{
      const[p]=await tx`SELECT p.*,m.text,m.run_ids FROM pending_agent_follow_ups p JOIN room_messages m ON m.id=p.message_id WHERE p.id=${id} FOR UPDATE OF p,m`;
      if(!p)return{status:'not_found' as const};
      if(p.status==='delivered'){const[r]=await tx`SELECT * FROM agent_runs WHERE id=(SELECT delivery_run_id FROM room_messages WHERE id=${p.message_id as string})`;return r?{status:'duplicate' as const,...runProjection(r)}:{status:'not_found' as const};}
      const[source]=await tx`SELECT * FROM agent_runs WHERE id=${p.anchor_run_id as string}`;
      if(!source)return{status:'not_found' as const};
      const now=new Date().toISOString(),runId=crypto.randomUUID(),slotId=crypto.randomUUID(),profile=source.execution_profile as RunExecutionProfileSnapshot,snapshot=project(source);
      await tx`INSERT INTO response_slots(id,message_id,persona_id,created_at) VALUES(${slotId},${p.message_id as string},${p.persona_id as string},${now})`;
      await tx`INSERT INTO agent_runs(id,message_id,room_id,persona_id,persona_version_id,persona_handle,requested_model,harness_instance_id,harness_type,model_id,execution_profile,project_id_snapshot,project_name_snapshot,project_path_snapshot,project_availability,status,response_slot_id,context,created_at,updated_at) VALUES(${runId},${p.message_id as string},${p.room_id as string},${p.persona_id as string},${source.persona_version_id as string},${p.persona_handle as string},${source.requested_model as string},${source.harness_instance_id as string},${source.harness_type as string},${source.model_id as string},${tx.json(profile as never)},${snapshot?.id??null},${snapshot?.name??null},${snapshot?.path??null},${snapshot?.availability??null},'queued',${slotId},${tx.json(history)},${now},${now})`;
      await tx`UPDATE room_messages SET run_ids=${tx.json([...(p.run_ids as string[]),runId])},delivery_route='room_context',delivery_status='fallback',delivery_run_id=${runId},delivery_error=NULL,delivery_updated_at=${now} WHERE id=${p.message_id as string}`;
      await tx`UPDATE pending_agent_follow_ups SET status='delivered',updated_at=${now} WHERE id=${id}`;
      const runEvent=await this.events.appendInTransaction(tx,String(p.room_id),'run.created',{id:runId,messageId:p.message_id,agent:p.persona_handle,requestedModel:source.requested_model,harnessInstanceId:source.harness_instance_id,harnessType:source.harness_type,modelId:source.model_id,executionProfile:profile,status:'queued',text:'',tools:[],interventions:[],artifacts:[],responseSlotId:slotId,...(snapshot?{recommendedProject:snapshot}:{})},now);
      const delivery:MessageDelivery={route:'room_context',status:'fallback',agent:String(p.persona_handle),anchorRunId:String(p.anchor_run_id),runId};
      const deliveryEvent=await this.events.appendInTransaction(tx,String(p.room_id),'message.delivery.updated',{messageId:String(p.message_id),delivery},now);
      return{status:'created' as const,...runProjection({...source,id:runId,message_id:p.message_id,room_id:p.room_id,persona_id:p.persona_id,persona_handle:p.persona_handle,response_slot_id:slotId,context:history}),text:String(p.text),runEvent,deliveryEvent};
    });
  }
}

function anchor(row:Record<string,unknown>):FollowUpAnchor{return{runId:String(row.id),roomId:String(row.room_id),personaId:String(row.persona_id),personaHandle:String(row.persona_handle),status:String(row.status)};}
function pending(row:Record<string,unknown>):PendingFollowUp{return{id:String(row.id),roomId:String(row.room_id),messageId:String(row.message_id),personaId:String(row.persona_id),personaHandle:String(row.persona_handle),anchorRunId:String(row.anchor_run_id),deliveryKind:row.delivery_kind as PendingFollowUp['deliveryKind'],status:String(row.status),text:String(row.text)};}
function project(row:Record<string,unknown>):RunProjectSnapshot|undefined{return row.project_id_snapshot?{id:String(row.project_id_snapshot),name:String(row.project_name_snapshot),path:String(row.project_path_snapshot),availability:String(row.project_availability) as RunProjectSnapshot['availability']}:undefined;}
function runProjection(row:Record<string,unknown>){return{runId:String(row.id),messageId:String(row.message_id),roomId:String(row.room_id),personaId:String(row.persona_id),personaVersionId:String(row.persona_version_id),personaHandle:String(row.persona_handle),requestedModel:String(row.requested_model),harnessInstanceId:String(row.harness_instance_id),harnessType:String(row.harness_type),modelId:String(row.model_id),executionProfile:row.execution_profile as RunExecutionProfileSnapshot,recommendedProject:project(row),responseSlotId:String(row.response_slot_id),history:(row.context as ConversationItem[])??[]};}
