import type {ExecutionIntent,ReasoningEffortSource,RunExecutionProfileSnapshot} from '@agenvyl/contracts';
import type {ConnectorCatalogModel,ConnectorExecutionControls} from '@agenvyl/connector-contract';

export function resolveExecutionProfile(input:{
  roomOverride:string|null;
  personaDefault:string|null;
  model:ConnectorCatalogModel;
  controls:ConnectorExecutionControls;
  permissionProfileId:string|null;
  agentVariantId:string|null;
  intent?:ExecutionIntent;
}):RunExecutionProfileSnapshot{
  const resolved=resolveReasoningEffort(input.roomOverride,input.personaDefault,input.model);
  const workflowMode=input.intent?.kind==='plan'?'plan':'work';
  return{
    workflowMode,
    requestedReasoningEffort:resolved.requested,
    reasoningEffort:resolved.effective,
    reasoningEffortFallback:resolved.fallback,
    reasoningEffortSource:resolved.source,
    planEnforcement:workflowMode==='plan'?(input.controls.nativeWorkflowModes.includes('plan')?'native':'instruction_only'):null,
    permissionProfileId:input.permissionProfileId??input.controls.permissionProfiles[0]?.id??null,
    agentVariantId:input.agentVariantId,
    implementationPlanVersionId:input.intent?.kind==='implement'?input.intent.approved_plan_version_id:null,
  };
}

export function resolveReasoningEffort(roomOverride:string|null,personaDefault:string|null,model:ConnectorCatalogModel):{
  requested:string|null;
  effective:string|null;
  fallback:boolean;
  source:ReasoningEffortSource;
}{
  const requested=roomOverride??personaDefault??model.defaultReasoningEffort??null;
  const source:ReasoningEffortSource=roomOverride!==null?'room_override':personaDefault!==null?'persona_default':model.defaultReasoningEffort!=null?'model_default':'auto';
  if(source==='model_default'||source==='auto')return{requested,effective:requested,fallback:false,source};
  const effective=requested!==null&&(model.reasoningEfforts??[]).includes(requested)?requested:model.defaultReasoningEffort??null;
  return{requested,effective,fallback:requested!==effective,source};
}
