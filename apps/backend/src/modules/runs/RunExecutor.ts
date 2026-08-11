import { stableSessionId } from './stableSessionId.js';
import type { RoomEventService } from '../room-events/RoomEventService.js';
import type { ApprovalChoice, MappedRunEvent, RunEventMapping, RunEventStream, RunGateway, RunRecovery } from '../harness/harness.ports.js';
import type {RunRequestResolution} from '@agenvyl/contracts';
import { AppError } from '../../shared/errors/AppError.js';
import { mapUpstreamError } from '../../shared/errors/mapUpstreamError.js';
import type { RunContext, RunStatus } from '../../types.js';
import type { ActiveRunRegistry } from './ActiveRunRegistry.js';
import type { PersonaRepository } from '../personas/personas.repository.js';
import type { PersistedNonTerminalRun, RunRepository } from './runs.repository.js';
import type {RoomWorkspaceService} from '../workspace/RoomWorkspaceService.js';
import type {MessageRepository} from '../messages/messages.repository.js';
import {formatHumanMessage} from '../messages/messages.repository.js';
import {connectorLifecycleErrorCode,type ConnectorLifecycle,type ConnectorLifecycleErrorCode} from '../connector/connector.ports.js';
import type {ConnectorDirectoryValidation,ExecutionSnapshot} from '@agenvyl/connector-contract';
import {extractExternalImageReferences} from '../workspace/workspaceEmbeds.js';

type RunExecutorDependencies = {
  personas: PersonaRepository;
  runs: RunRepository;
  events: RoomEventService;
  runGateway: RunGateway;
  runEvents: RunEventStream;
  connectorExecution?:RunGateway&RunEventStream&RunRecovery;
  activeRuns: ActiveRunRegistry;
  concurrency?:number;
  runTimeoutMs?:number;
  logger?:LifecycleLogger;
  roomWorkspace?:RoomWorkspaceService;
  messages?:MessageRepository;
  connector?:ConnectorLifecycle&{validateDirectory?(path:string):Promise<ConnectorDirectoryValidation>};
  recoveryHealthAttempts?:number;
  recoveryHealthDelayMs?:number;
};

type LifecycleLogger={info(fields:Record<string,unknown>,message:string):void;warn(fields:Record<string,unknown>,message:string):void};
type QueuedRun={runId:string;text:string};
const noopLogger:LifecycleLogger={info(){},warn(){}};

export class RunExecutor {
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly scheduled=new Set<string>();
  private readonly pending:QueuedRun[]=[];
  private readonly concurrency:number;
  private readonly runTimeoutMs:number;
  private readonly deadlineTimers=new Map<string,ReturnType<typeof setTimeout>>();
  private readonly stopTasks=new Map<string,Promise<void>>();
  private readonly logger:LifecycleLogger;
  private readonly recoveryHealthAttempts:number;
  private readonly recoveryHealthDelayMs:number;
  private closing=false;

  constructor(private readonly dependencies: RunExecutorDependencies) {this.concurrency=Math.max(1,dependencies.concurrency??4);this.runTimeoutMs=Math.max(1,dependencies.runTimeoutMs??15*60_000);this.logger=dependencies.logger??noopLogger;this.recoveryHealthAttempts=Math.max(1,dependencies.recoveryHealthAttempts??6);this.recoveryHealthDelayMs=Math.max(0,dependencies.recoveryHealthDelayMs??1_000);}

  start(runId: string, text: string) {
    if(this.closing||this.scheduled.has(runId))return;
    this.scheduled.add(runId);this.pending.push({runId,text});
    const run=this.dependencies.activeRuns.get(runId);this.logger.info({runId,roomId:run?.roomId,correlationId:run?.correlationId,transition:'queued',queued:this.pending.length},'Run queued');
    this.pump();
  }

  async reconcilePersistedRuns(){
    const persisted=await this.dependencies.runs.listNonTerminal();
    let recovered=0;
    const direct=persisted.filter(run=>!run.connectorExecutionId),connectorRuns=persisted.filter(run=>run.connectorExecutionId);
    for(const run of direct){
      if(await this.failPersisted(run.id,'Backend restarted before run reached a terminal state'))recovered++;
      this.logger.warn({runId:run.id,roomId:run.roomId,correlationId:'startup-recovery',upstreamRunId:run.upstreamRunId,transition:'failed'},'Recovered orphaned legacy run without Connector checkpoint');
    }
    if(!connectorRuns.length)return recovered;
    const connector=this.dependencies.connector,executionTransport=this.dependencies.connectorExecution;
    if(!connector){for(const run of connectorRuns)if(await this.failPersisted(run.id,'Connector execution recovery is not configured','connector_unavailable'))recovered++;return recovered;}
    let connectorEpoch:string;
    try{connectorEpoch=(await this.waitForRecoveryHealth(connector)).connectorEpoch;}catch{for(const run of connectorRuns)if(await this.failPersisted(run.id,'Connector is unavailable during persisted execution recovery','connector_unavailable'))recovered++;return recovered;}
    for(const run of connectorRuns){
      if(run.connectorEpoch!==connectorEpoch){if(await this.failPersisted(run.id,'Connector restarted before run reached a terminal state','connector_restarted'))recovered++;continue;}
      if(!executionTransport){if(await this.failPersisted(run.id,'Connector execution recovery is not configured','connector_unavailable'))recovered++;continue;}
      try{
        const execution=await connector.inspect(run.connectorExecutionId!);
        if(execution.connectorEpoch!==run.connectorEpoch){if(await this.failPersisted(run.id,'Connector restarted before run reached a terminal state','connector_restarted'))recovered++;continue;}
        if(run.connectorCursor!>execution.cursor){if(await this.failPersisted(run.id,'Persisted Connector cursor is ahead of the inspected execution','connector_invalid_response'))recovered++;continue;}
        if(run.connectorCursor!<execution.earliestReplayableCursor-1){if(await this.failPersisted(run.id,'Connector events are no longer replayable','connector_replay_unavailable'))recovered++;continue;}
        executionTransport.reattach({checkpoint:{executionId:run.connectorExecutionId!,connectorEpoch:run.connectorEpoch!,cursor:run.connectorCursor!},pendingRequests:execution.pendingRequests});
        this.resumePersisted(run,execution,executionTransport);
        this.logger.info({runId:run.id,roomId:run.roomId,correlationId:'startup-recovery',connectorExecutionId:run.connectorExecutionId,connectorEpoch,connectorCursor:run.connectorCursor,transition:'reattached'},'Reattached recoverable Connector run');
      }catch(error){const code=connectorLifecycleErrorCode(error);if(await this.failPersisted(run.id,connectorRecoveryMessage(code,error),code))recovered++;}
    }
    return recovered;
  }

  private async waitForRecoveryHealth(connector:ConnectorLifecycle){
    let lastError:unknown;
    for(let attempt=1;attempt<=this.recoveryHealthAttempts;attempt++){
      try{return await connector.health();}catch(error){
        lastError=error;
        if(attempt===this.recoveryHealthAttempts)break;
        this.logger.info({correlationId:'startup-recovery',attempt,nextAttempt:attempt+1,delayMs:this.recoveryHealthDelayMs,transition:'waiting_connector'},'Waiting for Connector before persisted execution recovery');
        await delay(this.recoveryHealthDelayMs);
      }
    }
    throw lastError;
  }

  private resumePersisted(persisted:PersistedNonTerminalRun,execution:ExecutionSnapshot,transport:RunGateway&RunEventStream&RunRecovery){
    const pendingRequests=new Map(execution.pendingRequests.map(request=>[request.id,{...request,resolved:request.resolution?.outcome}])),run:RunContext={id:persisted.id,messageId:persisted.messageId,roomId:persisted.roomId,personaVersionId:persisted.personaVersionId,personaHandle:persisted.personaHandle,requestedModel:persisted.requestedModel,harnessInstanceId:persisted.harnessInstanceId,harnessType:persisted.harnessType,modelId:persisted.modelId,executionProfile:persisted.executionProfile,recommendedProject:persisted.recommendedProject,conversationHistory:persisted.context,responseText:persisted.text,upstreamRunId:persisted.connectorExecutionId!,connectorExecutionId:persisted.connectorExecutionId!,...(persisted.executionDeadlineAt?{executionDeadlineAt:persisted.executionDeadlineAt}:{}),status:persisted.status as RunStatus,terminal:false,started:true,refreshContext:false,stopping:persisted.status==='stopping'||execution.status==='stopping',pendingRequests};
    this.dependencies.activeRuns.add(run);
    const task=this.consumeRecovered(run,execution,transport).finally(()=>{this.tasks.delete(run.id);this.pump();});
    this.tasks.set(run.id,task);
  }

  private async consumeRecovered(run:RunContext,execution:ExecutionSnapshot,transport:RunEventStream){
    run.controller=new AbortController();
    try{
      run.executionDeadlineAt??=await this.dependencies.runs.ensureExecutionDeadline(run.id,this.runTimeoutMs);
      if(!run.executionDeadlineAt)throw new Error('Could not restore execution deadline');
      if(new Date(run.executionDeadlineAt).getTime()<=Date.now()){await this.timeout(run);return;}
      this.armDeadline(run);
      if(run.terminal)return;
      const restoredStatus=recoveredStatus(execution);
      if(restoredStatus&&run.status!==restoredStatus){await this.dependencies.events.emit(run.roomId,'run.status',{runId:run.id,status:restoredStatus});run.status=restoredStatus;}
      await this.consumeStream(run,transport,run.upstreamRunId!);
      if(!run.terminal){const terminal=connectorTerminal(execution);if(terminal)await this.terminal(run,terminal.status,terminal.error);else await this.terminal(run,'failed','Connector event stream ended without a terminal lifecycle event');}
    }catch(error){if(run.terminal)return;if(error instanceof Error&&error.name==='AbortError'&&(run.stopping||(this.closing&&run.connectorExecutionId)))return;const code=connectorLifecycleErrorCode(error);await this.terminal(run,'failed',connectorRecoveryMessage(code,error),code);}
  }

  private async failPersisted(runId:string,error:string,errorCode?:string){const failed=await this.dependencies.runs.failNonTerminal(runId,error,errorCode);if(!failed)return false;this.dependencies.events.publishPersisted(failed.roomId,failed.event);try{await this.dependencies.roomWorkspace?.finalizeRun(failed.roomId,runId,'failed')}catch{/* durable terminal state is retained with capture diagnostics */}this.logger.warn({runId,roomId:failed.roomId,correlationId:'startup-recovery',transition:'failed',errorCode},'Reconciled persisted run as failed');return true;}

  async cancel(runId: string) {
    const { activeRuns, events, runs } = this.dependencies;
    const run = activeRuns.get(runId);
    if (!run) {
      const persisted = await runs.control(runId);
      if (!persisted) throw new AppError('not_found', 404, 'Run not found');
      if (isTerminal(persisted.status)) {
        throw new AppError('already_terminal', 409, 'Run is already terminal');
      }

      await events.emit(persisted.room_id, 'run.status', { runId: persisted.id, status: 'stopping' });
      let upstreamStopped = false;
      const executionId=persisted.connector_execution_id,gateway=this.dependencies.connectorExecution;
      if (executionId&&gateway) {
        try {
          const checkpoint=await gateway.stop(executionId);
          if(checkpoint)await runs.advanceConnectorCheckpoint(persisted.id,checkpoint);
          upstreamStopped = true;
        } catch {
          // Persisted orphan recovery remains best-effort.
        }
      }
      try{await this.dependencies.roomWorkspace?.finalizeRun(persisted.room_id,persisted.id,'cancelled')}catch{/* cancellation remains durable even if capture fails */}
      await events.emit(persisted.room_id, 'run.status', { runId: persisted.id, status: 'cancelled' });
      return {
        status: 'cancelled',
        adapter: 'persisted_run_recovery',
        upstream_stopped: upstreamStopped,
      };
    }

    if (run.terminal) throw new AppError('already_terminal', 409, 'Run is already terminal');
    const queuedIndex=this.pending.findIndex(item=>item.runId===runId);
    if(queuedIndex>=0){this.pending.splice(queuedIndex,1);this.scheduled.delete(runId);await this.terminal(run,'cancelled');this.pump();return{status:'cancelled',adapter:'local_queue'};}
    if (!run.stopping) {
      run.stopping = true;
      await events.emit(run.roomId, 'run.status', { runId: run.id, status: 'stopping' });
    }
    if (run.upstreamRunId) {
      try {
        await this.stopUpstream(run);
      } catch (error) {
        throw mapUpstreamError(error);
      }
    }
    return { status: 'stopping', adapter: 'run_gateway' };
  }

  async approve(runId: string, requestId:string, input: RunRequestResolution|string|undefined) {
    const { activeRuns } = this.dependencies;
    const run = activeRuns.get(runId);
    if (!run) throw new AppError('not_found', 404, 'Run not found');
    const pending=run.pendingRequests?.get(requestId);
    if(!pending)throw new AppError('request_not_active',409,'Run request is not active');
    if(pending.kind==='elicitation'){
      const answer=typeof input==='object'&&input&&'elicitation'in input?input.elicitation:undefined;
      if(!run.upstreamRunId||!answer||!validElicitationAnswer(answer))throw new AppError('invalid_elicitation_resolution',400,'MCP elicitation response is invalid');
      const gateway=this.gatewayFor(run);if(!gateway.elicit)throw new AppError('unsupported',409,'The configured run gateway has no verified elicitation resolution endpoint');
      try{const checkpoint=await gateway.elicit(run.upstreamRunId,requestId,answer);if(checkpoint)await this.dependencies.runs.advanceConnectorCheckpoint(run.id,checkpoint);}
      catch(error){throw mapUpstreamError(error);}
      return;
    }
    if (pending.kind === 'clarification') {
      const resolution=typeof input==='string'?{resolution:input.trim()}:input,gateway=this.gatewayFor(run);
      if(!run.upstreamRunId||!resolution||('resolution' in resolution&&!resolution.resolution))throw new AppError('invalid_clarification_resolution',400,'Clarification answer must not be empty');
      if('resolution' in resolution&&resolution.resolution.length>2_000)throw new AppError('invalid_clarification_resolution',400,'Clarification answer is too long');
      if('answers' in resolution&&(!Object.keys(resolution.answers).length||Object.values(resolution.answers).some(values=>!Array.isArray(values)||values.some(value=>typeof value!=='string'||value.length>2_000))))throw new AppError('invalid_clarification_resolution',400,'Structured clarification answers are invalid');
      if(!gateway.clarify)throw new AppError('unsupported',409,'The configured run gateway has no verified clarification resolution endpoint');
      try{const checkpoint=await gateway.clarify(run.upstreamRunId,requestId,resolution);if(checkpoint)await this.dependencies.runs.advanceConnectorCheckpoint(run.id,checkpoint);}
      catch(error){throw mapUpstreamError(error);}
      return;
    }
    if (!run.upstreamRunId || pending.kind !== 'approval') {
      throw new AppError('approval_not_active', 409, 'Approval is not active');
    }
    const choice=typeof input==='string'?input:'resolution' in (input??{})?(input as {resolution:string}).resolution:undefined;
    if (!isApprovalChoice(choice)) {
      throw new AppError('invalid_approval_choice', 400, 'Invalid approval choice');
    }
    try {
      const checkpoint=await this.gatewayFor(run).approve(run.upstreamRunId,requestId,choice);
      if(checkpoint)await this.dependencies.runs.advanceConnectorCheckpoint(run.id,checkpoint);
    } catch (error) {
      throw mapUpstreamError(error);
    }
  }

  async approveLegacy(runId:string,input:RunRequestResolution|string|undefined){
    const run=this.dependencies.activeRuns.get(runId);
    if(!run)throw new AppError('not_found',404,'Run not found');
    const pending=[...(run.pendingRequests?.keys()??[])];
    if(pending.length!==1)throw new AppError('ambiguous_request',409,pending.length?'Multiple run requests are active; resolve one by request ID':'Run request is not active');
    return this.approve(runId,pending[0]!,input);
  }

  async shutdown(timeoutMs=10_000) {
    this.closing=true;
    for(const timer of this.deadlineTimers.values())clearTimeout(timer);this.deadlineTimers.clear();
    const queued=this.pending.splice(0);
    for(const item of queued){this.scheduled.delete(item.runId);const run=this.dependencies.activeRuns.get(item.runId);if(run)await this.terminal(run,'failed','Backend shut down before queued run started');}
    for (const run of this.dependencies.activeRuns.values()) run.controller?.abort();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const settled=Promise.allSettled(this.tasks.values()).then(()=>true),completed=await Promise.race([settled,new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);
    if(timer)clearTimeout(timer);
    if(!completed)this.logger.warn({active:this.tasks.size,timeoutMs},'Run executor shutdown timed out');
    return completed;
  }

  stats(){return{active:this.tasks.size,queued:this.pending.length,limit:this.concurrency};}

  private gatewayFor(run:RunContext){return run.connectorExecutionId&&this.dependencies.connectorExecution?this.dependencies.connectorExecution:this.dependencies.runGateway;}

  private pump(){
    this.pending.splice(0,this.pending.length,...this.pending.filter(item=>this.dependencies.activeRuns.get(item.runId)));
    while(!this.closing&&this.tasks.size<this.concurrency){
      const index=this.pending.findIndex((item,pendingIndex)=>this.canStart(item,pendingIndex));if(index<0)break;
      const[next]=this.pending.splice(index,1),run=this.dependencies.activeRuns.get(next.runId);if(!run)continue;run.started=true;
      this.logger.info({runId:next.runId,roomId:run.roomId,messageId:run.messageId,correlationId:run.correlationId,transition:'starting',active:this.tasks.size+1},'Run starting');
      const task=this.execute(next.runId,next.text).finally(()=>{this.tasks.delete(next.runId);this.scheduled.delete(next.runId);this.pump();});this.tasks.set(next.runId,task);
    }
  }

  private canStart(item:QueuedRun,pendingIndex:number){
    const run=this.dependencies.activeRuns.get(item.runId);if(!run)return false;
    const runningInRoom=[...this.tasks.keys()].map(id=>this.dependencies.activeRuns.get(id)).filter((candidate):candidate is RunContext=>candidate!==undefined&&candidate.roomId===run.roomId);
    if(runningInRoom.length)return false;
    const earlier=this.pending.slice(0,pendingIndex).map(candidate=>this.dependencies.activeRuns.get(candidate.runId)).find(candidate=>candidate?.roomId===run.roomId);
    return !earlier;
  }

  private async execute(runId: string, text: string) {
    const { activeRuns, events, runGateway, runEvents, personas, runs } = this.dependencies;
    const run = activeRuns.get(runId);
    if (!run) return;
    run.controller = new AbortController();

    try {
      const version = await personas.version(run.personaVersionId);
      if (!version) throw new Error(`Persona version ${run.personaVersionId} not found`);
      const persona = await personas.find(version.persona_id);
      if (!persona) throw new Error(`Persona ${version.persona_id} not found`);
      if (!run.personaHandle) run.personaHandle = persona.handle;
      const currentMessage=this.dependencies.messages&&run.messageId?await this.dependencies.messages.find(run.roomId,run.messageId):undefined;
      const input=currentMessage?`${formatHumanMessage(currentMessage)}${text.startsWith(currentMessage.text)?text.slice(currentMessage.text.length):''}`:text;
      let immutableContextInstructions='';
      if(this.dependencies.messages&&run.messageId&&run.refreshContext!==false){
        const context=await this.dependencies.messages.conversationContextForRun(run.roomId,run.personaHandle,run.messageId);run.conversationHistory=context.history;await runs.setContext(run.id,context.history);
        if(this.dependencies.roomWorkspace&&context.references.length){const versions=await Promise.all(context.references.map(async reference=>({...reference,immutablePath:await this.dependencies.roomWorkspace!.immutableVersionAgentPath(run.roomId,reference.versionId)})));immutableContextInstructions=`\n\n<historical_workspace_context>\nThis is an internal mapping between historical workspace files and their immutable versions. Use these paths only to read the exact historical context. Never quote, summarize, or reproduce this block or its internal paths in your response.\n${versions.map(item=>`- ${item.path} => ${item.immutablePath}`).join('\n')}\n</historical_workspace_context>`;}
      }
      const roomPersonas = await personas.list(run.roomId);
      run.recommendedProject??=await runs.recommendedProject(run.id);
      immutableContextInstructions=await this.projectInstructions(run)+immutableContextInstructions;
      const sessionId = run.sessionId ?? stableSessionId(run.roomId, run.id);
      run.sessionId = sessionId;
      const preparedWorkspace=await this.dependencies.roomWorkspace?.prepareRun(run.roomId,run.id);
      const human=currentMessage?.author;
      const identityInstructions=`\n\nPlatform entity identity (mandatory invariant):\n- You are the current agent: ${persona.name} (@${run.personaHandle}).\n- The human user is ${human?`${human.displayName} (@${human.handle})`:'the local user'}; this is a separate human entity, not a persona or agent.\n- The remaining personas below are other agents, not the human user.\nThe current message has already been routed to you according to its explicit recipient field. A mention of @${run.personaHandle} addresses you, not a third party.`;
      const participantInstructions=`\n\nOther active agents in the room:\n${roomPersonas.filter(item=>item.handle!==run.personaHandle).map(item=>`- @${item.handle} — ${item.name}`).join('\n')||'- none'}\n\nWhen mentioning an agent, always use the exact @handle from this list. Do not use a bare handle as a mention and do not invent new handles. Never identify the human user as an agent merely because of a mention or the message topic.`;
      const workflowInstructions=await this.workflowInstructions(run);
      const instructions = `${version.system_prompt}${identityInstructions}${participantInstructions}${immutableContextInstructions}${workflowInstructions}\n\nRespond only as yourself. Do not impersonate other agents or add messages, sections, or signatures on their behalf.\n\nFormat the response as Markdown when it improves readability. Paragraphs, lists, headings, links, tables, and fenced code blocks are allowed. Do not wrap the entire response in one code block and do not use HTML.\n\nEvery image in the response must be stored in the room workspace. Never embed an external image with ![](http://...) or ![](https://...), even if the URL works in a browser. Download it directly to a temporary name inside the workspace; never use /tmp or another external directory. Verify a successful HTTP response, non-zero size, and the actual image format, then atomically rename the temporary file inside the workspace. Do not use sudo. To embed the stored image in the response, use ![Caption](workspace:path/to/file.png). The path is relative to the workspace root; encode spaces and special characters as URI components. PNG, JPEG, WebP, and GIF are allowed, with no more than 10 distinct images per response. Normal clickable links to external pages are allowed.`;
      const handle = await runGateway.createRun({
        executionId:run.id,
        harnessInstanceId:run.harnessInstanceId,
        modelId:run.modelId,
        executionProfile:run.executionProfile,
        workspace:{roomId:run.roomId,relativePath:preparedWorkspace?.relativePath??'.',...(preparedWorkspace?.absolutePath?{absolutePath:preparedWorkspace.absolutePath}:{})},
        input,
        sessionId,
        instructions,
        conversationHistory: run.conversationHistory,
        model: run.requestedModel,
      });
      const upstreamRunId=handle.id;
      run.upstreamRunId = upstreamRunId;
      if(handle.harnessType)run.harnessType=handle.harnessType;
      if(handle.checkpoint)run.connectorExecutionId=handle.checkpoint.executionId;
      this.logger.info({runId:run.id,roomId:run.roomId,correlationId:run.correlationId,upstreamRunId,transition:'upstream_started'},'Upstream run started');
      if(handle.checkpoint)await runs.bindConnectorExecution(run.id,handle.checkpoint,{harnessType:run.harnessType,adapterGeneration:handle.adapterGeneration});
      else await runs.setUpstream(run.id, upstreamRunId);

      if(handle.checkpoint){run.executionDeadlineAt=await runs.ensureExecutionDeadline(run.id,this.runTimeoutMs);if(!run.executionDeadlineAt)throw new Error('Could not persist execution deadline');this.armDeadline(run);if(run.terminal)return;}

      if (run.stopping){await this.stopUpstream(run);}
      else{await events.emit(run.roomId, 'run.status', { runId, status: 'streaming' });run.status='streaming';}

      await this.consumeStream(run,runEvents,upstreamRunId);
      if (!run.terminal) {
        await this.terminal(run, 'failed', 'Upstream event stream ended without a terminal lifecycle event');
      }
    } catch (error) {
      if (run.terminal) return;
      if (error instanceof Error && error.name === 'AbortError' && (run.stopping||(this.closing&&run.connectorExecutionId))) return;
      this.logger.warn({runId:run.id,roomId:run.roomId,correlationId:run.correlationId,upstreamRunId:run.upstreamRunId,transition:'stream_failed',err:error},'Run failed before receiving a terminal lifecycle event');
      await this.terminal(run,'failed',error instanceof Error?error.message:String(error),error instanceof AppError?error.code:undefined);
    }
  }

  private async consumeStream(run:RunContext,runEvents:RunEventStream,executionId:string){
    for await(const mapping of runEvents.stream(executionId,run.id,run.controller!.signal)){
      if(run.terminal)break;
      await this.applyMapping(run,mapping);
    }
  }

  private async workflowInstructions(run:RunContext){
    if(run.executionProfile.workflowMode!=='plan')return'';
    return`\n\n<workflow_mode mode="plan" enforcement="${run.executionProfile.planEnforcement}">\nWork in read-only exploration mode. Inspect the request, the recommended project, and relevant context; discuss findings, options, risks, and tradeoffs, and ask focused clarifying questions when needed. Answer naturally. Do not produce a formal implementation plan or create plan.md unless the human explicitly asks for a plan. The workflow mode overrides imperative wording in the message: do not implement the requested change while Plan is active. Do not create, edit, move, or delete files in the recommended external project. Do not install dependencies or run commands that mutate project or external-system state. Managed artifacts may be created inside the Agenvyl run workspace when the harness permits it; normal room-workspace publication still applies.${run.executionProfile.planEnforcement==='instruction_only'?' This harness has no native Plan enforcement, so these restrictions are instruction-only and cannot technically prevent external project writes.':''}\n</workflow_mode>`;
  }

  private async applyMapping(run:RunContext,mapping:RunEventMapping){
    const mappedEvents:MappedRunEvent[]=[...(mapping.status&&mapping.status!==run.status?[{type:'run.status' as const,payload:{runId:run.id,status:mapping.status}}]:[]),...mapping.events];
    if(mapping.checkpoint){
      const accepted=await this.dependencies.runs.acceptConnectorTransition(run.id,mapping.checkpoint,mappedEvents);
      if(!accepted.accepted){if(mapping.terminal)await this.terminal(run,mapping.terminal.status,mapping.terminal.error,mapping.terminal.errorCode);return;}
      for(const event of accepted.events)this.dependencies.events.publishPersisted(accepted.roomId!,event);
      if(!mapping.terminal){
        const deadline=await this.dependencies.runs.refreshExecutionDeadline(run.id,this.runTimeoutMs);
        if(deadline){run.executionDeadlineAt=deadline;this.armDeadline(run);}
      }
    }else for(const event of mappedEvents)await this.dependencies.events.emit(run.roomId,event.type,event.payload);
    if(mapping.status)run.status=mapping.status;
    for(const event of mapping.events){
      if(event.type==='run.delta')run.responseText=(run.responseText??'')+String(event.payload.text??'');
      if(event.type==='request.created'&&typeof event.payload.requestId==='string'&&['approval','clarification','elicitation'].includes(String(event.payload.kind))){
        run.pendingRequests??=new Map();run.pendingRequests.set(event.payload.requestId,{id:event.payload.requestId,kind:event.payload.kind as import('@agenvyl/contracts').RunRequest['kind'],prompt:String(event.payload.prompt??''),...(typeof event.payload.directory==='string'?{directory:event.payload.directory}:{}),...(Array.isArray(event.payload.choices)?{choices:event.payload.choices as string[]}:{}),...(Array.isArray(event.payload.questions)?{questions:event.payload.questions as import('@agenvyl/contracts').StructuredQuestion[]}:{}),...(event.payload.elicitation?{elicitation:event.payload.elicitation as import('@agenvyl/contracts').McpElicitation}:{}),...(typeof event.payload.autoResolutionMs==='number'?{autoResolutionMs:event.payload.autoResolutionMs}:{})});
      }
      if(event.type==='request.resolved'&&typeof event.payload.requestId==='string')run.pendingRequests?.delete(event.payload.requestId);
      if(event.type==='run.intervention.updated'&&event.payload.intervention&&typeof event.payload.intervention==='object'){
        const intervention=event.payload.intervention as {id?:unknown;text?:unknown;status?:unknown};
        if(intervention.status==='pending'&&typeof intervention.id==='string'&&typeof intervention.text==='string'){run.pendingIntervention={id:intervention.id,text:intervention.text};run.responseText='';}
        if((intervention.status==='applied'||intervention.status==='failed')&&run.pendingIntervention?.id===intervention.id)run.pendingIntervention=undefined;
      }
    }
    if(mapping.terminal)await this.terminal(run,mapping.terminal.status,mapping.terminal.error,mapping.terminal.errorCode);
  }

  private async terminal(
    run: RunContext,
    status: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'>,
    error?: string,
    errorCode?:string,
  ) {
    if (run.terminal) return;
    const { activeRuns, events, runs } = this.dependencies;
    const responseText=run.responseText??await runs.text(run.id);
    if (status === 'completed' && containsForeignRole(responseText, run.personaHandle)) {
      status = 'failed';
      error = 'Response rejected: the agent generated a message on behalf of another role';
    }else if(status==='completed'&&extractExternalImageReferences(responseText).length){
      status='failed';
      error='Response rejected: external images must be saved to the workspace first';
      errorCode='external_image_not_persisted';
    }
    if(this.dependencies.roomWorkspace){
      const workspaceResult=await this.dependencies.roomWorkspace.runWorkspaceResult(run.id);
      if(workspaceResult&&workspaceResult.capture_status!=='failed'){await events.emit(run.roomId,'run.status',{runId:run.id,status:'finalizing'});run.status='finalizing';}
      try{
        await this.dependencies.roomWorkspace.finalizeRun(run.roomId,run.id,status);
      }catch(finalizeError){
        status='failed';
        error=finalizeError instanceof Error?`Could not finalize workspace: ${finalizeError.message}`:'Could not finalize workspace';
        errorCode='workspace_capture_failed';
      }
    }
    run.terminal = true;
    this.clearDeadline(run.id);
    run.pendingRequests?.clear();
    if(this.dependencies.roomWorkspace){try{const embeds=await this.dependencies.roomWorkspace.resolveRunEmbeds(run.roomId,run.id,responseText);await events.emit(run.roomId,'run.embeds',{runId:run.id,embeds})}catch{/* an embed rendering failure must not strand a durably finalized run */}}
    if(run.connectorExecutionId){const finished=await runs.finishNonTerminal(run.id,status,error,errorCode);if(!finished){activeRuns.remove(run.id);this.stopTasks.delete(run.id);return;}events.publishPersisted(finished.roomId,finished.event);}
    else await events.emit(run.roomId,'run.status',{runId:run.id,status,...(error?{error}:{}),...(errorCode?{errorCode}:{})});
    if (status === 'completed') {
      const slotId = await runs.selectCompletedAttempt(run.id);
      if (slotId) {
        await events.emit(run.roomId, 'run.selected', { responseSlotId: slotId, runId: run.id });
      }
    }
    activeRuns.remove(run.id);this.stopTasks.delete(run.id);
    this.logger.info({runId:run.id,roomId:run.roomId,correlationId:run.correlationId,upstreamRunId:run.upstreamRunId,transition:status,...(error?{error}: {})},'Run reached terminal state');
  }

  private async projectInstructions(run:RunContext){
    const project=run.recommendedProject;
    if(!project)return'';
    let availability:typeof project.availability='unknown';
    try{const result=await this.dependencies.connector?.validateDirectory?.(project.path);availability=result?.status==='available'?'available':'unavailable';}catch{/* Execution continues with explicit unknown availability. */}
    run.recommendedProject={...project,availability};
    await this.dependencies.runs.setProjectAvailability(run.id,availability);
    await this.dependencies.events.emit(run.roomId,'run.project.updated',{runId:run.id,project:run.recommendedProject});
    if(availability!=='available')return`\n\nRecommended project “${project.name}” is currently unavailable. Continue in the Agenvyl room workspace and do not assume that the configured project path can be accessed.`;
    return`\n\nRecommended project context for this room:\n- Name: ${project.name}\n- Local directory: ${project.path}\nPrefer this directory for project-related work. This is contextual guidance, not an access restriction or permission grant. You may use other directories when the task and current harness permissions allow it. The Agenvyl room workspace remains the location for managed attachments and response artifacts.`;
  }

  private armDeadline(run:RunContext){
    this.clearDeadline(run.id);
    const delay=Math.max(0,new Date(run.executionDeadlineAt!).getTime()-Date.now());
    const timer=setTimeout(()=>{this.deadlineTimers.delete(run.id);void this.timeout(run);},delay);
    this.deadlineTimers.set(run.id,timer);
  }

  private clearDeadline(runId:string){const timer=this.deadlineTimers.get(runId);if(timer)clearTimeout(timer);this.deadlineTimers.delete(runId);}

  private async timeout(run:RunContext){
    if(run.terminal||this.closing)return;
    run.terminal=true;run.pendingRequests?.clear();this.clearDeadline(run.id);run.controller?.abort();
    const error='Run exceeded the configured execution deadline',errorCode='run_timeout';
    const finished=await this.dependencies.runs.finishNonTerminal(run.id,'failed',error,errorCode);
    if(!finished){this.dependencies.activeRuns.remove(run.id);this.stopTasks.delete(run.id);return;}
    this.dependencies.events.publishPersisted(finished.roomId,finished.event);
    let upstreamStopped=false;
    if(run.upstreamRunId){try{await this.stopUpstream(run);upstreamStopped=true;}catch{/* timeout remains durably terminal even if upstream stop fails */}}
    try{await this.dependencies.roomWorkspace?.finalizeRun(run.roomId,run.id,'failed');}catch{/* timeout remains durably terminal even if workspace capture fails */}
    this.dependencies.activeRuns.remove(run.id);this.stopTasks.delete(run.id);
    this.logger.warn({runId:run.id,roomId:run.roomId,correlationId:run.correlationId,upstreamRunId:run.upstreamRunId,transition:'failed',errorCode,upstreamStopped},'Run execution deadline exceeded');
  }

  private stopUpstream(run:RunContext){
    const existing=this.stopTasks.get(run.id);if(existing)return existing;
    const task=(async()=>{if(!run.upstreamRunId)return;const checkpoint=await this.gatewayFor(run).stop(run.upstreamRunId);if(checkpoint)await this.dependencies.runs.advanceConnectorCheckpoint(run.id,checkpoint);})();
    this.stopTasks.set(run.id,task);return task;
  }
}

function isTerminal(status: string) {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function recoveredStatus(execution:ExecutionSnapshot):RunStatus|undefined{const pending=execution.pendingRequests[0];if(pending)return pending.kind==='approval'?'waiting_approval':'waiting_clarification';if(execution.status==='running')return'streaming';if(execution.status==='stopping')return'stopping';return undefined;}

function validElicitationAnswer(value:unknown):value is import('@agenvyl/contracts').McpElicitationAnswer{
  if(!value||typeof value!=='object'||!('action'in value)||!('content'in value))return false;
  const answer=value as {action:unknown;content:unknown};
  if(answer.action==='decline'||answer.action==='cancel')return answer.content===null;
  if(answer.action!=='accept'||!jsonValue(answer.content,0))return false;
  try{return JSON.stringify(answer.content).length<=64_000;}catch{return false;}
}
function jsonValue(value:unknown,depth:number):boolean{if(depth>12)return false;if(value===null||typeof value==='string'||typeof value==='boolean')return true;if(typeof value==='number')return Number.isFinite(value);if(Array.isArray(value))return value.length<=256&&value.every(item=>jsonValue(item,depth+1));if(!value||typeof value!=='object')return false;const values=Object.values(value);return values.length<=256&&values.every(item=>jsonValue(item,depth+1));}

function connectorTerminal(execution:ExecutionSnapshot):{status:'completed'|'failed'|'cancelled';error?:string}|undefined{if(execution.status==='completed')return{status:'completed'};if(execution.status==='cancelled')return{status:'cancelled'};if(execution.status==='failed')return{status:'failed',...(execution.error?.message?{error:execution.error.message}:{})};return undefined;}

function connectorRecoveryMessage(code:ConnectorLifecycleErrorCode,error:unknown){if(code==='connector_replay_unavailable')return'Connector events are no longer replayable';if(code==='connector_execution_lost')return'Connector execution is no longer available';if(code==='connector_invalid_response')return'Connector returned an invalid recovery stream';if(code==='connector_command_rejected')return'Connector rejected the recovery command';return error instanceof Error?error.message:'Connector is unavailable during execution recovery';}
function delay(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms));}

function isApprovalChoice(choice: string | undefined): choice is ApprovalChoice {
  return ['approved', 'denied', 'once', 'session', 'always', 'deny','allow_directory'].includes(choice ?? '');
}

function containsForeignRole(text: string, ownHandle: string | undefined) {
  const labels = text.matchAll(/\[Ответ агента\s+@([\w.-]+)\]/giu);
  return [...labels].some(([, handle]) => !ownHandle || handle.toLocaleLowerCase() !== ownHandle.toLocaleLowerCase());
}
