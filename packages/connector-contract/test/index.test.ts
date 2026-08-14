import { describe, expect, it } from 'vitest';
import { connectorContractFixtures, isConfigureConnectorInstancesRequest, isConnectorCatalog, isConnectorCommandResult, isConnectorExecutionEvent, isConnectorHealth, isConnectorInstanceList, isConnectorInterventionCommandResult, isConnectorRequestCommandResult, isCreateExecutionInterventionRequest, isExecutionSnapshot, isResolveConnectorRequest, isRestartConnectorInstanceResult, isStartExecutionRequest } from '../src/index.js';

describe('Connector v1 contract fixtures', () => {
  it('keeps health, discovery, execution and events runtime-valid', () => {
    expect(isConnectorHealth(connectorContractFixtures.health)).toBe(true);
    expect(isConnectorInstanceList(connectorContractFixtures.instances)).toBe(true);
    expect(isConnectorCatalog(connectorContractFixtures.catalog)).toBe(true);
    expect(isConnectorCommandResult({execution:connectorContractFixtures.execution})).toBe(true);
    expect(isConnectorRequestCommandResult({execution:connectorContractFixtures.execution,request:{id:'request-1',kind:'approval',prompt:'Allow?'}})).toBe(true);
    expect(isStartExecutionRequest(connectorContractFixtures.startExecution)).toBe(true);
    expect(isStartExecutionRequest({...connectorContractFixtures.startExecution,workspace:{...connectorContractFixtures.startExecution.workspace,project:{path:'C:\\work\\project',access:'read_write'}}})).toBe(true);
    expect(isStartExecutionRequest({...connectorContractFixtures.startExecution,workspace:{...connectorContractFixtures.startExecution.workspace,project:{path:'C:\\work\\project',access:'owner'}}})).toBe(false);
    expect(isExecutionSnapshot(connectorContractFixtures.execution)).toBe(true);
    expect(isConnectorExecutionEvent(connectorContractFixtures.textEvent)).toBe(true);
    expect(isConnectorExecutionEvent({...connectorContractFixtures.textEvent,type:'output.reasoning.delta'})).toBe(true);
    expect(isConnectorExecutionEvent({...connectorContractFixtures.textEvent,type:'execution.upstream_status',payload:{state:'retrying',reason:'rate_limited',retryable:true,attempt:2,retryAt:'2026-07-17T00:00:05.000Z'}})).toBe(true);
    expect(isExecutionSnapshot({...connectorContractFixtures.execution,upstreamStatus:{state:'waiting_upstream',reason:'awaiting_response',retryable:true}})).toBe(true);
    expect(isResolveConnectorRequest({ resolution: 'once' })).toBe(true);
    expect(isResolveConnectorRequest({elicitation:{action:'accept',content:{workspace:'main'}}})).toBe(true);
    expect(isResolveConnectorRequest({elicitation:{action:'decline',content:null}})).toBe(true);
    expect(isConnectorExecutionEvent({...connectorContractFixtures.textEvent,type:'request.opened',payload:{request:{id:'elicit-1',kind:'elicitation',prompt:'Choose',elicitation:{mode:'form',serverName:'nodexium',message:'Choose',requestedSchema:{type:'object',properties:{workspace:{type:'string'}}}}}}})).toBe(true);
    const intervention={interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'Focus on the API'};
    expect(isCreateExecutionInterventionRequest(intervention)).toBe(true);
    expect(isConnectorExecutionEvent({...connectorContractFixtures.textEvent,type:'execution.intervention.accepted',payload:intervention})).toBe(true);
    expect(isConnectorExecutionEvent({...connectorContractFixtures.textEvent,type:'execution.intervention.applied',payload:intervention})).toBe(true);
    expect(isConnectorExecutionEvent({...connectorContractFixtures.textEvent,type:'execution.intervention.failed',payload:{...intervention,error:{code:'redirect_failed',message:'Failed'}}})).toBe(true);
    expect(isConnectorInterventionCommandResult({execution:connectorContractFixtures.execution,intervention:{...intervention,status:'pending'}})).toBe(true);
  });

  it('rejects malformed epochs, cursors and payloads', () => {
    expect(isConnectorHealth({ ...connectorContractFixtures.health, connectorEpoch: 1 })).toBe(false);
    expect(isConnectorInstanceList({ ...connectorContractFixtures.instances, instances: [{ ...connectorContractFixtures.instances.instances[0], capabilities: ['auto_approve'] }] })).toBe(false);
    expect(isConnectorCatalog({ ...connectorContractFixtures.catalog, models: [{ id: '' }] })).toBe(false);
    expect(isConnectorCommandResult({execution:{...connectorContractFixtures.execution,cursor:-1}})).toBe(false);
    expect(isExecutionSnapshot({ ...connectorContractFixtures.execution, status: 'unknown' })).toBe(false);
    expect(isExecutionSnapshot({ ...connectorContractFixtures.execution, earliestReplayableCursor: 10 })).toBe(false);
    expect(isStartExecutionRequest({ ...connectorContractFixtures.startExecution, input: { history: [] } })).toBe(false);
    expect(isConnectorExecutionEvent({ ...connectorContractFixtures.textEvent, cursor: 0 })).toBe(false);
    expect(isConnectorExecutionEvent({ ...connectorContractFixtures.textEvent, payload: { text: 42 } })).toBe(false);
    const toolEvent={...connectorContractFixtures.textEvent,type:'tool.started',payload:{toolId:'tool-1',name:'mcpToolCall',safeSummary:'nodexium: search',safeInput:'{"query":"Codex"}'}};
    expect(isConnectorExecutionEvent(toolEvent)).toBe(true);
    for(const type of ['tool.updated','tool.completed','tool.failed','tool.cancelled'] as const){
      expect(isConnectorExecutionEvent({...toolEvent,type})).toBe(true);
    }
    expect(isConnectorExecutionEvent({...toolEvent,payload:{...toolEvent.payload,safeInput:42}})).toBe(false);
    expect(isConnectorExecutionEvent({...toolEvent,payload:{...toolEvent.payload,safeInput:'x'.repeat(8_001)}})).toBe(false);
    expect(isConnectorExecutionEvent({...connectorContractFixtures.textEvent,type:'execution.upstream_status',payload:{state:'retrying',reason:'vendor_secret',retryable:true}})).toBe(false);
    expect(isResolveConnectorRequest({ resolution: ' ' })).toBe(false);
    expect(isResolveConnectorRequest({ resolution: 'x'.repeat(2_001) })).toBe(false);
    expect(isResolveConnectorRequest({elicitation:{action:'decline',content:{}}})).toBe(false);
    expect(isConnectorExecutionEvent({...connectorContractFixtures.textEvent,type:'request.opened',payload:{request:{id:'elicit-1',kind:'elicitation',prompt:'Open',elicitation:{mode:'url',serverName:'nodexium',message:'Open',url:'javascript:alert(1)',elicitationId:'flow'}}}})).toBe(false);
    expect(isCreateExecutionInterventionRequest({interventionId:'not-a-uuid',text:'redirect'})).toBe(false);
    expect(isCreateExecutionInterventionRequest({interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:' '})).toBe(false);
  });

  it('accepts boolean managed ownership and rejects non-boolean values',()=>{
    const instance=connectorContractFixtures.instances.instances[0];
    expect(isConnectorInstanceList({...connectorContractFixtures.instances,instances:[{...instance,type:'opencode',managed:true}]})).toBe(true);
    expect(isConnectorInstanceList({...connectorContractFixtures.instances,instances:[{...instance,type:'opencode',managed:'yes'}]})).toBe(false);
    expect(isConnectorInstanceList({...connectorContractFixtures.instances,instances:[{...instance,type:'hermes',managed:true}]})).toBe(false);
  });

  it('validates active execution counts and restart results',()=>{
    const instance={...connectorContractFixtures.instances.instances[0],type:'opencode',managed:true,activeExecutions:0};
    expect(isConnectorInstanceList({...connectorContractFixtures.instances,instances:[instance]})).toBe(true);
    expect(isConnectorInstanceList({...connectorContractFixtures.instances,instances:[{...instance,activeExecutions:-1}]})).toBe(false);
    expect(isRestartConnectorInstanceResult({apiVersion:'v2',connectorEpoch:'epoch-1',instance,catalog:{models:[],controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]}}})).toBe(true);
    expect(isConnectorInstanceList({...connectorContractFixtures.instances,instances:[{...instance,interventionMode:'interrupt_then_continue'}]})).toBe(true);
    expect(isConnectorInstanceList({...connectorContractFixtures.instances,instances:[{...instance,interventionMode:'pause'}]})).toBe(false);
  });

  it('accepts only concrete absolute external-directory roots on OpenCode instances',()=>{
    const request=(externalDirectoryRoots:string[])=>({instances:[{id:'local-opencode',type:'opencode',enabled:true,externalDirectoryRoots}]});
    expect(isConfigureConnectorInstancesRequest(request(['/srv/shared','C:\\Shared']))).toBe(true);
    expect(isConfigureConnectorInstancesRequest(request([]))).toBe(true);
    expect(isConfigureConnectorInstancesRequest(request(['../shared']))).toBe(false);
    expect(isConfigureConnectorInstancesRequest(request(['/srv/*']))).toBe(false);
    expect(isConfigureConnectorInstancesRequest(request(['/srv/shared/../secret']))).toBe(false);
    expect(isConfigureConnectorInstancesRequest(request(['C:\\Shared/mixed']))).toBe(false);
    expect(isConfigureConnectorInstancesRequest(request(['/srv/shared','/srv/shared/']))).toBe(false);
    expect(isConfigureConnectorInstancesRequest({instances:[{id:'local-hermes',type:'hermes',enabled:true,externalDirectoryRoots:[]}]})).toBe(false);
  });

  it('rejects removed and unknown instance configuration fields',()=>{
    expect(isConfigureConnectorInstancesRequest({instances:[{id:'local-codex',type:'codex',enabled:true,allowDangerFullAccess:true}]})).toBe(false);
    expect(isConfigureConnectorInstancesRequest({instances:[{id:'local-antigravity',type:'antigravity',enabled:true,permissionMode:'plan'}]})).toBe(false);
    expect(isConfigureConnectorInstancesRequest({instances:[{id:'local-codex',type:'codex',enabled:true,unknown:true}]})).toBe(false);
  });
  it('accepts Cursor configuration only without an endpoint',()=>{expect(isConfigureConnectorInstancesRequest({instances:[{id:'local-cursor',type:'cursor',enabled:true}]})).toBe(true);expect(isConfigureConnectorInstancesRequest({instances:[{id:'local-cursor',type:'cursor',enabled:true,endpoint:'http://127.0.0.1:1'}]})).toBe(false);});
});
