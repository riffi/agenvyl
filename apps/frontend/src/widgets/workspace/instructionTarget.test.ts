import {describe,expect,it} from 'vitest';
import type {HarnessCatalog} from '../../entities/harness';
import type {Run} from '../../entities/run';
import {instructionTargetMode} from './instructionTarget';

const run:Run={id:'run-1',messageId:'message-1',agent:'coder',harnessInstanceId:'local-codex',harnessType:'codex',modelId:'gpt-5.6-sol',executionProfile:{workflowMode:'work',requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:null,agentVariantId:null},status:'completed',text:'Done',tools:[],interventions:[]};
const catalog:HarnessCatalog={connectorEpoch:'epoch',cache:{state:'fresh',refreshedAt:'2026-08-13T00:00:00.000Z',expiresAt:'2026-08-13T00:05:00.000Z'},instances:[{id:'local-codex',type:'codex',status:'healthy',capabilities:[],interventionMode:'interrupt_then_continue',postTurnContinuation:{mode:'native_session',durability:'connector_restart',retention:'explicit_release'},models:[],controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]},catalogCache:{state:'fresh',refreshedAt:'2026-08-13T00:00:00.000Z'}}]};

describe('instructionTargetMode',()=>{
  it('routes a completed Codex run to native post-turn continuation',()=>expect(instructionTargetMode(run,catalog)).toBe('post_turn_continuation'));
  it('routes an eligible streaming Codex run to active redirect',()=>expect(instructionTargetMode({...run,status:'streaming'},catalog)).toBe('active_redirect'));
  it('rejects a completed run without native continuation support',()=>expect(instructionTargetMode(run,{...catalog,instances:catalog.instances.map(instance=>({...instance,postTurnContinuation:undefined}))})).toBe('unavailable'));
});
