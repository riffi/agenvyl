import { describe, expect, it } from 'vitest';
import { connectorContractFixtures, isConnectorCatalog, isConnectorCommandResult, isConnectorExecutionEvent, isConnectorHealth, isConnectorInstanceList, isConnectorRequestCommandResult, isExecutionSnapshot, isResolveConnectorRequest, isStartExecutionRequest } from '../src/index.js';

describe('Connector v1 contract fixtures', () => {
  it('keeps health, discovery, execution and events runtime-valid', () => {
    expect(isConnectorHealth(connectorContractFixtures.health)).toBe(true);
    expect(isConnectorInstanceList(connectorContractFixtures.instances)).toBe(true);
    expect(isConnectorCatalog(connectorContractFixtures.catalog)).toBe(true);
    expect(isConnectorCommandResult({execution:connectorContractFixtures.execution})).toBe(true);
    expect(isConnectorRequestCommandResult({execution:connectorContractFixtures.execution,request:{id:'request-1',kind:'approval',prompt:'Allow?'}})).toBe(true);
    expect(isStartExecutionRequest(connectorContractFixtures.startExecution)).toBe(true);
    expect(isExecutionSnapshot(connectorContractFixtures.execution)).toBe(true);
    expect(isConnectorExecutionEvent(connectorContractFixtures.textEvent)).toBe(true);
    expect(isConnectorExecutionEvent({...connectorContractFixtures.textEvent,type:'output.reasoning.delta'})).toBe(true);
    expect(isConnectorExecutionEvent({...connectorContractFixtures.textEvent,type:'execution.upstream_status',payload:{state:'retrying',reason:'rate_limited',retryable:true,attempt:2,retryAt:'2026-07-17T00:00:05.000Z'}})).toBe(true);
    expect(isExecutionSnapshot({...connectorContractFixtures.execution,upstreamStatus:{state:'waiting_upstream',reason:'awaiting_response',retryable:true}})).toBe(true);
    expect(isResolveConnectorRequest({ resolution: 'once' })).toBe(true);
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
    expect(isConnectorExecutionEvent({...toolEvent,payload:{...toolEvent.payload,safeInput:42}})).toBe(false);
    expect(isConnectorExecutionEvent({...toolEvent,payload:{...toolEvent.payload,safeInput:'x'.repeat(8_001)}})).toBe(false);
    expect(isConnectorExecutionEvent({...connectorContractFixtures.textEvent,type:'execution.upstream_status',payload:{state:'retrying',reason:'vendor_secret',retryable:true}})).toBe(false);
    expect(isResolveConnectorRequest({ resolution: ' ' })).toBe(false);
    expect(isResolveConnectorRequest({ resolution: 'x'.repeat(2_001) })).toBe(false);
  });

  it('accepts boolean managed ownership and rejects non-boolean values',()=>{
    const instance=connectorContractFixtures.instances.instances[0];
    expect(isConnectorInstanceList({...connectorContractFixtures.instances,instances:[{...instance,type:'opencode',managed:true}]})).toBe(true);
    expect(isConnectorInstanceList({...connectorContractFixtures.instances,instances:[{...instance,type:'opencode',managed:'yes'}]})).toBe(false);
    expect(isConnectorInstanceList({...connectorContractFixtures.instances,instances:[{...instance,type:'hermes',managed:true}]})).toBe(false);
  });
});
