import {describe,expect,it} from 'vitest';
import type {Run} from '../../run';
import {initialState,roomReducer,type RoomEvent} from './roomState';

const run:Run={id:'r1',messageId:'m1',agent:'coder',harnessInstanceId:'local-hermes',harnessType:'hermes',modelId:'sol',executionProfile:{workflowMode:'work',requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,planEnforcement:null,permissionProfileId:null,agentVariantId:null,approvedPlanRunId:null},status:'queued',text:'',tools:[]};
const event=(sequence:number,type:RoomEvent['type'],payload:unknown)=>({id:`e${sequence}`,sequence,type,payload}) as RoomEvent;

describe('roomReducer',()=>{
  it('streams content, tools, usage, and terminal state',()=>{let state=roomReducer(initialState,event(1,'run.created',run));state=roomReducer(state,event(2,'run.reasoning.delta',{runId:'r1',text:'thinking'}));state=roomReducer(state,event(3,'run.delta',{runId:'r1',text:'hello'}));state=roomReducer(state,event(4,'tool.updated',{runId:'r1',tool:{id:'t',name:'read',detail:'file',status:'completed'}}));state=roomReducer(state,event(5,'run.usage',{runId:'r1',usage:{inputTokens:20,outputTokens:5}}));state=roomReducer(state,event(6,'run.status',{runId:'r1',status:'completed'}));expect(state.runs.r1).toMatchObject({reasoning:'thinking',text:'hello',status:'completed',usage:{inputTokens:20},tools:[{id:'t'}]})});
  it('updates room execution state without timeline messages',()=>{const plan={run_id:'r1',agent:'coder',created_at:'2026-01-01',excerpt:'Plan'};let state=roomReducer(initialState,event(1,'room.execution_profile.updated',{workflow_mode:'plan',reasoning_effort:'high'}));state=roomReducer(state,event(2,'room.approved_plan.updated',{approvedPlan:plan}));expect(state.executionState).toEqual({profile:{workflow_mode:'plan',reasoning_effort:'high'},approved_plan:plan});expect(state.messages).toEqual([])});
  it('ignores replayed duplicate sequence',()=>{const state=roomReducer(initialState,event(1,'run.created',run));expect(roomReducer(state,event(1,'run.delta',{runId:'r1',text:'duplicate'}))).toBe(state)});
});
