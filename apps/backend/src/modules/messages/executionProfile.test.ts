import {describe,expect,it} from 'vitest';
import {resolveExecutionProfile} from './executionProfile';

const controls={nativeWorkflowModes:['plan','work'] as Array<'plan'|'work'>,permissionProfiles:[{id:'workspace-write'}],agentVariants:[]};
describe('resolveExecutionProfile',()=>{
  const state=(reasoning_effort:string|null)=>({profile:{reasoning_effort},plan:{path:'plan.md' as const,current:null,approved:null}});
  it('keeps requested effort when supported and snapshots native Plan',()=>expect(resolveExecutionProfile({state:state('high'),intent:{kind:'plan'},model:{id:'gpt',reasoningEfforts:['low','high'],defaultReasoningEffort:'low'},controls,permissionProfileId:null,agentVariantId:null})).toEqual({workflowMode:'plan',requestedReasoningEffort:'high',reasoningEffort:'high',reasoningEffortFallback:false,planEnforcement:'native',permissionProfileId:'workspace-write',agentVariantId:null,implementationPlanVersionId:null}));
  it('falls back visibly and carries the authoritative plan only for Implement',()=>expect(resolveExecutionProfile({state:state('max'),intent:{kind:'implement',approved_plan_version_id:'version-1'},model:{id:'small',reasoningEfforts:['low'],defaultReasoningEffort:'low'},controls:{...controls,nativeWorkflowModes:[]},permissionProfileId:'read-only',agentVariantId:'build'})).toMatchObject({workflowMode:'work',requestedReasoningEffort:'max',reasoningEffort:'low',reasoningEffortFallback:true,planEnforcement:null,permissionProfileId:'read-only',agentVariantId:'build',implementationPlanVersionId:'version-1'}));
  it('does not carry an approved plan into ordinary Work',()=>expect(resolveExecutionProfile({state:state(null),model:{id:'small'},controls,permissionProfileId:null,agentVariantId:null}).implementationPlanVersionId).toBeNull());
  it('marks unsupported Plan as instruction-only',()=>expect(resolveExecutionProfile({state:state(null),intent:{kind:'plan'},model:{id:'hermes'},controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]},permissionProfileId:null,agentVariantId:null}).planEnforcement).toBe('instruction_only'));
});
