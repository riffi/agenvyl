import { parseMentions } from '../../routing.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { Persona } from '../../types.js';
import type { RoomEventService } from '../room-events/RoomEventService.js';
import type { ActiveRunRegistry } from '../runs/ActiveRunRegistry.js';
import type { RunExecutor } from '../runs/RunExecutor.js';
import type { PersonaRepository } from '../personas/personas.repository.js';
import type { MessageRepository } from './messages.repository.js';
import type {RoomWorkspaceService} from '../workspace/RoomWorkspaceService.js';

export class CreateMessageRound {
  constructor(private readonly dependencies: { personas: PersonaRepository; messages: MessageRepository; events: RoomEventService; harnesses:{catalog():Promise<{instances:Array<{id:string;type:string;status:string;models:Array<{id:string;label?:string}>;modes:Array<{id:string;label?:string}>}>}>}; activeRuns: ActiveRunRegistry; runExecutor: RunExecutor;roomWorkspace?:RoomWorkspaceService }) {}

  async execute(command: { roomId: string; text?: string; targets?: string[]; messageId?: string;attachmentVersionIds?:string[];correlationId?:string }) {
    const text = command.text?.trim() ?? '';
    if (!text && !(command.attachmentVersionIds?.length)) throw new AppError('text_required', 400, 'Message text or attachment is required');
    if (command.messageId !== undefined && !/^[0-9a-f-]{36}$/i.test(command.messageId)) throw new AppError('invalid_message_id', 400, 'Invalid message ID');
    const { personas, messages, events, harnesses, activeRuns, runExecutor } = this.dependencies;
    if (command.messageId) {
      const existing = await messages.find(command.roomId, command.messageId);
      if (existing) return { status: 'duplicate' as const, message: existing };
    }
    const available = await personas.list(command.roomId);
    const byHandle = new Map(available.map(persona => [persona.handle, persona]));
    const handles = command.targets === undefined ? parseMentions(text, available.map(persona => persona.handle)) : command.targets;
    const unique = [...new Set(handles)];
    const targets = unique.map(handle => byHandle.get(handle)).filter((persona): persona is Persona => Boolean(persona));
    if (targets.length !== unique.length) {
      const archived = new Set((await personas.list(command.roomId, true)).filter(persona => persona.archived_at).map(persona => persona.handle));
      const archivedHandles = unique.filter(handle => archived.has(handle));
      if (archivedHandles.length) throw new AppError('persona_archived', 409, 'Persona is archived', { handles: archivedHandles });
      throw new AppError('unknown_target', 400, 'Unknown target persona');
    }
    if (targets.length) {
      const catalog=await harnesses.catalog();
      for(const persona of targets){
        const instance=catalog.instances.find(item=>item.id===persona.harness_instance_id&&item.type===persona.harness_type);
        if(!instance||instance.status==='unavailable')throw new AppError('harness_unavailable',503,'Harness instance is unavailable',{harnessInstanceId:persona.harness_instance_id,persona:persona.handle});
        const model=instance.models.find(item=>item.id===persona.model_id);
        if(!model)throw new AppError('unknown_model',400,'Unknown model',{model:persona.model_id,harnessInstanceId:persona.harness_instance_id,persona:persona.handle});
        if(persona.mode_id&&!instance.modes.some(item=>item.id===persona.mode_id))throw new AppError('unknown_mode',400,'Unknown harness mode',{mode:persona.mode_id,harnessInstanceId:persona.harness_instance_id,persona:persona.handle});
        await personas.setEffectiveModel(persona.id,model.label??model.id);
      }
    }
    if((command.attachmentVersionIds?.length??0)>10)throw new AppError('too_many_attachments',400,'A message can include no more than 10 attachments');
    const addressedToAll=targets.length===available.length&&/(^|[^\p{L}\p{N}_])@all(?![\p{L}\p{N}_-])/iu.test(text);
    let round;try{round=await messages.createRound(command.roomId, text, targets, command.messageId,command.attachmentVersionIds??[],addressedToAll);}catch(error){if(error instanceof Error&&error.message==='attachment_unavailable')throw new AppError('attachment_unavailable',409,'Attachment version is unavailable');throw error;}
    if (round.duplicate) return { status: 'duplicate' as const, message: round.message };
    for (const event of round.events) events.publishPersisted(command.roomId, event);
    for (const item of round.runs) activeRuns.add({ id: item.id, messageId:round.message.id, roomId: command.roomId, personaVersionId: item.version.id, personaHandle: item.persona.handle, requestedModel: item.version.requested_model!, harnessInstanceId:item.version.harness_instance_id,harnessType:item.version.harness_type,modelId:item.version.model_id,modeId:item.version.mode_id,conversationHistory: item.history,correlationId:command.correlationId, terminal: false,started:false,refreshContext:true });
    const attachmentLines=await Promise.all((round.message.attachments??[]).map(async item=>`- ${item.path} (${item.mime_type}, version ${item.version_id}): ${this.dependencies.roomWorkspace?await this.dependencies.roomWorkspace.snapshotAgentPath(command.roomId,item.version_id):item.version_id}\n  Current path: ${this.dependencies.roomWorkspace?.agentRoomPath(command.roomId)}/${item.path}`));
    const attachmentPrompt=attachmentLines.length?`\n\nUser attachments. Read the captured paths for this task even if the current file changes later:\n${attachmentLines.join('\n')}`:'';
    for (const item of round.runs) runExecutor.start(item.id, `${text}${attachmentPrompt}`);
    return { status: 'created' as const, message: round.message };
  }
}
