import {describe,expect,it} from 'vitest';
import type {RunExecutionProfileSnapshot} from '@agenvyl/contracts';
import {transitionExecutionProfile} from './workflowModeTransition.js';

const source:RunExecutionProfileSnapshot={workflowMode:'work',requestedReasoningEffort:'high',reasoningEffort:'medium',reasoningEffortFallback:true,reasoningEffortSource:'room_override',planEnforcement:null,permissionProfileId:'trusted',agentVariantId:'reviewer'};

describe('transitionExecutionProfile',()=>{
  it('changes only workflow enforcement when entering native Plan',()=>{
    expect(transitionExecutionProfile(source,'plan',{nativeWorkflowModes:['plan']})).toEqual({...source,workflowMode:'plan',planEnforcement:'native'});
  });

  it('uses instruction-only Plan when the harness has no native Plan control',()=>{
    expect(transitionExecutionProfile(source,'plan',{nativeWorkflowModes:[]})).toEqual({...source,workflowMode:'plan',planEnforcement:'instruction_only'});
  });

  it('clears Plan enforcement when returning to Work',()=>{
    expect(transitionExecutionProfile({...source,workflowMode:'plan',planEnforcement:'native'},'work',{nativeWorkflowModes:['plan']})).toEqual(source);
  });
});
