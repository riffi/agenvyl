import type {ConnectorExecutionControls} from '@agenvyl/connector-contract';
import type {RunExecutionProfileSnapshot,WorkflowMode} from '@agenvyl/contracts';

export const transitionExecutionProfile=(
  source:RunExecutionProfileSnapshot,
  workflowMode:WorkflowMode,
  controls:Pick<ConnectorExecutionControls,'nativeWorkflowModes'>,
):RunExecutionProfileSnapshot=>({
  ...source,
  workflowMode,
  planEnforcement:workflowMode==='plan'?(controls.nativeWorkflowModes.includes('plan')?'native':'instruction_only'):null,
});
