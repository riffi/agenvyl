import type {RoomExecutionState,RunExecutionProfileSnapshot} from '@agenvyl/contracts';
import type {ConnectorCatalogModel,ConnectorExecutionControls} from '@agenvyl/connector-contract';

export function resolveExecutionProfile(input:{
  state:RoomExecutionState;
  model:ConnectorCatalogModel;
  controls:ConnectorExecutionControls;
  permissionProfileId:string|null;
  agentVariantId:string|null;
}):RunExecutionProfileSnapshot{
  const requested=input.state.profile.reasoning_effort,supported=input.model.reasoningEfforts??[];
  const effective=requested===null?(input.model.defaultReasoningEffort??null):supported.includes(requested)?requested:(input.model.defaultReasoningEffort??null);
  const workflowMode=input.state.profile.workflow_mode;
  return{
    workflowMode,
    requestedReasoningEffort:requested,
    reasoningEffort:effective,
    reasoningEffortFallback:requested!==null&&effective!==requested,
    planEnforcement:workflowMode==='plan'?(input.controls.nativeWorkflowModes.includes('plan')?'native':'instruction_only'):null,
    permissionProfileId:input.permissionProfileId??input.controls.permissionProfiles[0]?.id??null,
    agentVariantId:input.agentVariantId,
    approvedPlanRunId:workflowMode==='work'?input.state.approved_plan?.run_id??null:null,
  };
}
