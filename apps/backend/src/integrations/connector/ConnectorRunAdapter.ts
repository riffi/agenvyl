import type { ConnectorExecutionEvent, ConnectorRequestSnapshot, ExecutionSnapshot } from '@agenvyl/connector-contract';
import type { ConnectorExecutionClient } from '../../modules/connector/connector.ports.js';
import type { ApprovalChoice, DependencyHealth, ReattachRunInput, RunCheckpoint, RunEventMapping, RunEventStream, RunGateway, RunHandle, RunRecovery, StartRunInput } from '../../modules/harness/harness.ports.js';

type ExecutionState={connectorEpoch:string;cursor:number;pendingRequests:Map<string,ConnectorRequestSnapshot>};

export class ConnectorRunAdapter implements RunGateway,RunEventStream,RunRecovery,DependencyHealth {
  private readonly executions=new Map<string,ExecutionState>();

  constructor(private readonly connector:ConnectorExecutionClient){}

  async capabilities(){try{const health=await this.connector.health();return{ok:health.status==='ready',status:health.status==='ready'?200:503,data:{apiVersion:health.apiVersion,status:health.status}};}catch(error){return{ok:false,status:0,error:error instanceof Error?error.message:String(error)};}}

  async createRun(input:StartRunInput):Promise<RunHandle>{
    const execution=await this.connector.start({
      executionId:input.executionId,
      harnessInstanceId:input.harnessInstanceId,
      modelId:input.modelId,
      modeId:input.modeId,
      workspace:{roomId:input.workspace.roomId,relativePath:input.workspace.relativePath},
      input:{systemPrompt:input.instructions,history:input.conversationHistory??[],message:input.input},
    });
    this.remember(execution);
    return{id:execution.executionId,checkpoint:checkpoint(execution)};
  }

  reattach(input:ReattachRunInput){
    this.executions.set(input.checkpoint.executionId,{connectorEpoch:input.checkpoint.connectorEpoch,cursor:input.checkpoint.cursor,pendingRequests:new Map(input.pendingRequests.map(request=>[request.id,request]))});
  }

  async stop(executionId:string):Promise<RunCheckpoint>{
    const execution=await this.connector.stop(executionId);
    return this.controlCheckpoint(execution);
  }

  async approve(executionId:string,choice:ApprovalChoice):Promise<RunCheckpoint>{
    const state=this.executions.get(executionId);
    const request=[...(state?.pendingRequests.values()??[])].find(candidate=>candidate.kind==='approval');
    if(!request)throw new Error('Connector has no active approval request for this execution');
    const result=await this.connector.resolve(executionId,request.id,normalizeApproval(choice));
    return this.controlCheckpoint(result.execution);
  }

  async clarify(executionId:string,resolution:string):Promise<RunCheckpoint>{
    const state=this.executions.get(executionId);
    const request=[...(state?.pendingRequests.values()??[])].find(candidate=>candidate.kind==='clarification');
    if(!request)throw new Error('Connector has no active clarification request for this execution');
    const result=await this.connector.resolve(executionId,request.id,resolution);
    return this.controlCheckpoint(result.execution);
  }

  async *stream(executionId:string,localRunId:string,signal:AbortSignal):AsyncIterable<RunEventMapping>{
    const state=this.executions.get(executionId);
    if(!state)throw new Error('Connector execution state is not initialized');
    for await(const event of this.connector.events(executionId,{after:state.cursor,connectorEpoch:state.connectorEpoch,signal})){
      if(event.type==='request.opened')state.pendingRequests.set(event.payload.request.id,event.payload.request);
      if(event.type==='request.resolved')state.pendingRequests.delete(event.payload.requestId);
      yield{...mapConnectorEvent(localRunId,event),checkpoint:{executionId,connectorEpoch:state.connectorEpoch,cursor:event.cursor}};
      // The consumer durably accepts the mapping before requesting the next item.
      // Keep controls on that acknowledged cursor so approval/stop cannot jump
      // over an SSE event that Core is still committing.
      state.cursor=event.cursor;
    }
  }

  private remember(execution:ExecutionSnapshot){
    this.executions.set(execution.executionId,{connectorEpoch:execution.connectorEpoch,cursor:execution.cursor,pendingRequests:new Map(execution.pendingRequests.map(request=>[request.id,request]))});
  }

  private controlCheckpoint(execution:ExecutionSnapshot){
    const current=this.executions.get(execution.executionId);
    if(!current){this.remember(execution);return checkpoint(execution);}
    if(current.connectorEpoch!==execution.connectorEpoch||execution.cursor<current.cursor)throw new Error('Connector control response conflicts with the accepted execution checkpoint');
    return{executionId:execution.executionId,connectorEpoch:current.connectorEpoch,cursor:current.cursor};
  }
}

function checkpoint(execution:ExecutionSnapshot):RunCheckpoint{return{executionId:execution.executionId,connectorEpoch:execution.connectorEpoch,cursor:execution.cursor};}

function normalizeApproval(choice:ApprovalChoice){return choice==='approved'?'once':choice==='denied'?'deny':choice;}

function mapConnectorEvent(localRunId:string,event:ConnectorExecutionEvent):RunEventMapping{
  switch(event.type){
    case'execution.accepted':return{events:[]};
    case'execution.started':return{events:[],status:'streaming'};
    case'execution.status':return{events:[],...(event.payload.status==='running'?{status:'streaming' as const}:{})};
    case'execution.upstream_status':return{events:[{type:'run.upstream_status',payload:{runId:localRunId,...event.payload}}]};
    case'output.text.delta':return{events:[{type:'run.delta',payload:{runId:localRunId,text:event.payload.text}}]};
    case'output.reasoning.delta':return{events:[{type:'run.reasoning.delta',payload:{runId:localRunId,text:event.payload.text}}]};
    case'usage.updated':return{events:[{type:'run.usage',payload:{runId:localRunId,usage:event.payload.usage}}]};
    case'tool.started':case'tool.updated':case'tool.completed':return{events:[{type:'tool.updated',payload:{runId:localRunId,tool:{id:event.payload.toolId,name:event.payload.name,detail:event.payload.safeSummary,status:event.type==='tool.started'?'started':event.type==='tool.completed'?'completed':'progress'}}}]};
    case'request.opened':return{events:[{type:'request.created',payload:{runId:localRunId,requestId:event.payload.request.id,kind:event.payload.request.kind,prompt:event.payload.request.prompt,...(event.payload.request.choices?{choices:event.payload.request.choices}:{})}}],status:event.payload.request.kind==='approval'?'waiting_approval':'waiting_clarification'};
    case'request.resolved':return{events:[{type:'request.resolved',payload:{runId:localRunId,requestId:event.payload.requestId,resolution:event.payload.outcome}}]};
    case'execution.completed':return{events:[],terminal:{status:'completed'}};
    case'execution.cancelled':return{events:[],terminal:{status:'cancelled'}};
    case'execution.failed':return{events:[],terminal:{status:'failed',error:event.payload.error.message}};
  }
}
