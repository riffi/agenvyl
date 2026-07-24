import { describe, expect, it } from 'vitest';
import { isServerRoomEvent } from '../src/index.js';

describe('room event contract', () => {
  it('accepts a valid server event', () => {
    expect(isServerRoomEvent({
      id: 'event-1',
      sequence: 1,
      type: 'run.delta',
      payload: { runId: 'run-1', text: 'hello' },
    })).toBe(true);
    expect(isServerRoomEvent({id:'event-r',sequence:2,type:'run.reasoning.delta',payload:{runId:'run-1',text:'thinking'}})).toBe(true);
    expect(isServerRoomEvent({id:'event-2',sequence:2,type:'tool.updated',payload:{runId:'run-1',tool:{id:'tool-1',name:'read_file',detail:'src/app.ts',input:'{"path":"src/app.ts"}',status:'started'}}})).toBe(true);
    expect(isServerRoomEvent({id:'event-3',sequence:3,type:'run.created',payload:{id:'run-1',messageId:'message-1',agent:'coder',requestedModel:'sol',harnessInstanceId:'local-hermes',harnessType:'hermes',modelId:'sol',executionProfile:{workflowMode:'work',requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:null,agentVariantId:null,implementationPlanVersionId:null},status:'queued',text:'',tools:[]}})).toBe(true);
    expect(isServerRoomEvent({id:'event-4',sequence:4,type:'message.created',payload:{id:'message-1',text:'hello',createdAt:'2026-01-01',targets:['coder'],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}})).toBe(true);
    expect(isServerRoomEvent({id:'event-5',sequence:5,type:'run.upstream_status',payload:{runId:'run-1',state:'retrying',reason:'rate_limited',retryable:true,attempt:2,retryAt:'2026-07-20T12:00:00.000Z'}})).toBe(true);
    expect(isServerRoomEvent({id:'event-6',sequence:6,type:'run.upstream_status',payload:{runId:'run-1',state:'waiting_upstream',reason:'awaiting_response',retryable:true}})).toBe(true);
    expect(isServerRoomEvent({id:'event-7',sequence:7,type:'room.plan.approval.updated',payload:{approved:{entry_id:'entry-1',version_id:'version-1'}}})).toBe(true);
    expect(isServerRoomEvent({id:'event-8',sequence:8,type:'run.workspace.finalized',payload:{runId:'run-1',workspaceResult:{base_snapshot_id:'base',result_snapshot_id:'base',capture_status:'complete',publish_status:'noop',conflict_count:0,errors:[]}}})).toBe(true);
  });

  it('rejects unknown and malformed events', () => {
    expect(isServerRoomEvent({ id: 'event-1', sequence: 1, type: 'unknown', payload: {} })).toBe(false);
    expect(isServerRoomEvent({ id: 'event-1', sequence: 1, type: 'run.delta', payload: { runId: 'run-1' } })).toBe(false);
    expect(isServerRoomEvent({ id: 'event-1', sequence: 1, type: 'run.created', payload: { id:'run-1',messageId:'message-1',agent:'coder',requestedModel:42,status:'queued',text:'',tools:[] } })).toBe(false);
    expect(isServerRoomEvent({id:'event-2',sequence:2,type:'message.created',payload:{id:'message-1',text:'hello',targets:[],runIds:[]}})).toBe(false);
    expect(isServerRoomEvent({id:'event-3',sequence:3,type:'run.upstream_status',payload:{runId:'run-1',state:'retrying',reason:'raw_vendor_reason',retryable:true}})).toBe(false);
  });
});
