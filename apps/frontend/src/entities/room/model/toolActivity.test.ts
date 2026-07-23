import { describe, expect, it } from 'vitest';
import type { Run } from '../../run';
import { initialState, roomReducer, type RoomEvent } from './roomState';

const event=(sequence:number,payload:Extract<RoomEvent,{type:'tool.updated'}>['payload'])=>({id:`event-${sequence}`,sequence,type:'tool.updated' as const,payload});

describe('tool activity state',()=>{
  it('keeps tool input when later status updates omit it',()=>{
    const run:Run={id:'run-1',messageId:'message-1',agent:'coder',harnessInstanceId:'local-hermes',harnessType:'hermes',modelId:'sol',executionProfile:{workflowMode:'work',requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:null,agentVariantId:null,implementationPlanVersionId:null},status:'streaming',text:'',tools:[]};
    const state={...initialState,runs:{[run.id]:run},runOrder:[run.id]};
    const started=roomReducer(state,event(1,{runId:run.id,tool:{id:'tool-1',name:'read_file',detail:'src/app.ts',input:'{"path":"src/app.ts"}',status:'started'}}));
    const completed=roomReducer(started,event(2,{runId:run.id,tool:{id:'tool-1',name:'read_file',detail:'',status:'completed'}}));
    expect(completed.runs[run.id].tools[0]).toEqual({id:'tool-1',name:'read_file',input:'{"path":"src/app.ts"}',detail:'src/app.ts',status:'completed'});
  });
});
