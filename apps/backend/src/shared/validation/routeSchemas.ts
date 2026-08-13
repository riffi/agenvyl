const nullableStringSchema={anyOf:[{type:'null'},{type:'string'}]} as const;

export const idParamsSchema = objectSchema({ id: { type: 'string' } }, ['id']);
export const roomParamsSchema = objectSchema({ roomId: { type: 'string' } }, ['roomId']);
export const runParamsSchema = objectSchema({ runId: { type: 'string' } }, ['runId']);
export const runRequestParamsSchema=objectSchema({runId:{type:'string'},requestId:{type:'string'}},['runId','requestId']);
export const runInterventionBodySchema=objectSchema({intervention_id:{type:'string',format:'uuid'},text:{type:'string',minLength:1,maxLength:2_000,pattern:'\\S'}},['intervention_id','text']);
export const runInterventionResponseSchema={oneOf:[
  objectSchema({mode:{type:'string',const:'active_redirect'},intervention_id:{type:'string',format:'uuid'},status:{type:'string',const:'pending'}},['mode','intervention_id','status']),
  objectSchema({mode:{type:'string',const:'post_turn_continuation'},intervention_id:{type:'string',format:'uuid'},run_id:{type:'string'},continued_from_run_id:{type:'string'}},['mode','intervention_id','run_id','continued_from_run_id']),
]} as const;
export const participantParamsSchema = objectSchema(
  { roomId: { type: 'string' }, personaId: { type: 'string' } },
  ['roomId', 'personaId'],
);

export const roomQuerySchema = objectSchema({
  include_archived: { type: 'string', enum: ['true', 'false'] },
  room_id: { type: 'string' },
});

export const roomEventsQuerySchema = objectSchema({ after: { type: 'string' } });
export const roomTimelineQuerySchema = objectSchema({
  before: { type: 'string' },
  limit: { type: 'string', pattern: '^[0-9]+$' },
});

export const createRoomBodySchema = objectSchema({
  title: { type: 'string' },
  persona_ids: { type: 'array', items: { type: 'string' } },
  project_id: nullableStringSchema,
});

export const renameRoomBodySchema = objectSchema({ title: { type: 'string' } });
export const assignRoomProjectBodySchema=objectSchema({project_id:nullableStringSchema},['project_id']);
const workflowModeSchema={type:'string',enum:['plan','work']} as const;
export const updateRoomWorkflowModeBodySchema=objectSchema({workflow_mode:workflowModeSchema},['workflow_mode']);
export const roomWorkflowStateResponseSchema=objectSchema({workflow_mode:workflowModeSchema},['workflow_mode']);
export const updateRoomPersonaBodySchema=objectSchema({reasoning_effort_override:nullableStringSchema},['reasoning_effort_override']);
export const runPreviewParamsSchema=objectSchema({roomId:{type:'string'},runId:{type:'string'}},['roomId','runId']);
export const runPreviewAssetParamsSchema=objectSchema({roomId:{type:'string'},runId:{type:'string'},'*':{type:'string'}},['roomId','runId','*']);

export const createPersonaBodySchema = {
  ...objectSchema({
    handle: { type: 'string' },
    name: { type: 'string' },
    room_id: { type: 'string' },
    color: { type: 'string' },
    requested_model: nullableStringSchema,
    harness_instance_id: { type: 'string' },
    model_id: { type: 'string' },
    permission_profile_id: nullableStringSchema,
    agent_variant_id: nullableStringSchema,
    default_reasoning_effort: nullableStringSchema,
    system_prompt: { type: 'string' },
    group_id: nullableStringSchema,
  }),
  not: { required: ['role'] },
} as const;

export const groupBodySchema=objectSchema({name:{type:'string',maxLength:80}});
export const moveGroupBodySchema=objectSchema({direction:{type:'string',enum:['up','down']}},['direction']);
export const reorderGroupBodySchema=objectSchema({position:{type:'integer',minimum:0}},['position']);

export const updatePersonaBodySchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ...createPersonaBodySchema.properties,
    reset_room_reasoning_overrides: { type: 'boolean' },
  },
  not: { required: ['role'] },
} as const;

export const createMessageBodySchema = objectSchema({
  text: { type: 'string' },
  targets: { type: 'array', items: { type: 'string' } },
  message_id: { type: 'string' },
  attachment_version_ids:{type:'array',items:{type:'string'},maxItems:10},
});

export const userProfileBodySchema=objectSchema({display_name:{type:'string',maxLength:120},handle:{type:'string',maxLength:80}},['display_name','handle']);
export const userProfileResponseSchema=objectSchema({id:{type:'string'},displayName:{type:'string'},handle:{type:'string'},createdAt:{type:'string'},updatedAt:{type:'string'}},['id','displayName','handle','createdAt','updatedAt']);

export const runRequestResolutionBodySchema = {anyOf:[
  objectSchema({resolution:{type:'string',minLength:1,maxLength:2_000}},['resolution']),
  objectSchema({answers:{type:'object',minProperties:1,maxProperties:4,additionalProperties:{type:'array',minItems:1,items:{type:'string',maxLength:2_000},maxItems:10}}},['answers']),
  objectSchema({elicitation:{anyOf:[
    objectSchema({action:{type:'string',const:'accept'},content:{}},['action','content']),
    objectSchema({action:{type:'string',enum:['decline','cancel']},content:{type:'null'}},['action','content']),
  ]}},['elicitation']),
]} as const;

export const roomResponseSchema = objectSchema({
  id:{type:'string'},title:{type:'string'},created_at:{type:'string'},participant_count:{type:'integer'},
  last_message_at:nullableStringSchema,last_message_text:nullableStringSchema,
  deleted_at:nullableStringSchema,
  project:{anyOf:[{type:'null'},objectSchema({id:{type:'string'},name:{type:'string'},path:{type:'string'},availability:{type:'string',enum:['available','unavailable','unknown']}},['id','name','path','availability'])]},
  workflow_mode:workflowModeSchema,
},['id','title','created_at','participant_count','last_message_at','last_message_text','deleted_at','project','workflow_mode']);

export const personaGroupResponseSchema=objectSchema({
  id:{type:'string'},name:{type:'string'},position:{type:'integer'},created_at:{type:'string'},updated_at:{type:'string'},
},['id','name','position','created_at','updated_at']);

export const personaResponseSchema=objectSchema({
  id:{type:'string'},handle:{type:'string'},name:{type:'string'},color:{type:'string'},
  requested_model:nullableStringSchema,effective_model:nullableStringSchema,
  harness_instance_id:{type:'string'},harness_type:{type:'string'},model_id:{type:'string'},permission_profile_id:nullableStringSchema,agent_variant_id:nullableStringSchema,default_reasoning_effort:nullableStringSchema,
  current_version_id:{type:'string'},system_prompt:{type:'string'},group_id:nullableStringSchema,
  created_at:{type:'string'},updated_at:{type:'string'},archived_at:nullableStringSchema,
},['id','handle','name','color','requested_model','harness_instance_id','harness_type','model_id','permission_profile_id','agent_variant_id','default_reasoning_effort','group_id','archived_at']);
export const roomPersonaResponseSchema=objectSchema({persona:personaResponseSchema,reasoning_effort_override:nullableStringSchema},['persona','reasoning_effort_override']);
export const participantListResponseSchema={type:'array',items:roomPersonaResponseSchema} as const;

const humanAuthorSnapshotResponseSchema=objectSchema({profileId:{type:'string'},displayName:{type:'string'},handle:{type:'string'}},['profileId','displayName','handle']);
export const messageResponseSchema=objectSchema({
  id:{type:'string'},text:{type:'string'},createdAt:{type:'string'},targets:{type:'array',items:{type:'string'}},runIds:{type:'array',items:{type:'string'}},attachments:{type:'array'},author:humanAuthorSnapshotResponseSchema,addressedToAll:{type:'boolean'},
},['id','text','createdAt','targets','runIds','attachments','author','addressedToAll']);

const toolActivityResponseSchema=objectSchema({id:{type:'string'},name:{type:'string'},detail:{type:'string'},input:{type:'string'},status:{type:'string',enum:['started','progress','completed','failed','cancelled']}},['id','name','detail','status']);
const upstreamStatusResponseSchema=objectSchema({state:{type:'string',enum:['waiting_upstream','retrying']},reason:{type:'string'},retryable:{type:'boolean'},attempt:{type:'integer',minimum:0},retryAt:{type:'string'},message:{type:'string'}},['state','reason','retryable']);
const connectorRunStateResponseSchema=objectSchema({state:{type:'string',enum:['active','degraded','terminal','unavailable','lost']},checkpointed:{type:'boolean'}},['state','checkpointed']);
const structuredQuestionOptionResponseSchema=objectSchema({label:{type:'string'},description:{type:'string'}},['label']);
const structuredQuestionResponseSchema=objectSchema({id:{type:'string'},header:{type:'string'},question:{type:'string'},options:{type:'array',items:structuredQuestionOptionResponseSchema},isOther:{type:'boolean'},isSecret:{type:'boolean'},multiSelect:{type:'boolean'}},['id','header','question','isOther','isSecret']);
const mcpElicitationResponseSchema={anyOf:[objectSchema({mode:{type:'string',enum:['form','openai/form']},serverName:{type:'string'},message:{type:'string'},requestedSchema:{}},['mode','serverName','message','requestedSchema']),objectSchema({mode:{type:'string',const:'url'},serverName:{type:'string'},message:{type:'string'},url:{type:'string'},elicitationId:{type:'string'}},['mode','serverName','message','url','elicitationId'])]} as const;
const runRequestResponseSchema=objectSchema({id:{type:'string'},kind:{type:'string',enum:['approval','clarification','elicitation']},prompt:{type:'string'},directory:{type:'string'},choices:{type:'array',items:{type:'string'}},questions:{type:'array',items:structuredQuestionResponseSchema,maxItems:4},elicitation:mcpElicitationResponseSchema,autoResolutionMs:{type:'integer'},resolved:{type:'string'}},['id','kind','prompt']);
const runInterventionResponseItemSchema=objectSchema({id:{type:'string'},text:{type:'string'},status:{type:'string',enum:['pending','applied','failed']},precedingText:{type:'string'},author:humanAuthorSnapshotResponseSchema,createdAt:{type:'string'},supersededText:{type:'string'},error:{type:'string'},errorCode:{type:'string'}},['id','text','status']);
const runExecutionProfileResponseSchema=objectSchema({workflowMode:workflowModeSchema,requestedReasoningEffort:nullableStringSchema,reasoningEffort:nullableStringSchema,reasoningEffortFallback:{type:'boolean'},reasoningEffortSource:{type:'string',enum:['room_override','persona_default','model_default','auto']},planEnforcement:{anyOf:[{type:'null'},{type:'string',enum:['native','instruction_only']}]},permissionProfileId:nullableStringSchema,agentVariantId:nullableStringSchema},['workflowMode','requestedReasoningEffort','reasoningEffort','reasoningEffortFallback','reasoningEffortSource','planEnforcement','permissionProfileId','agentVariantId']);
const workspaceCaptureErrorSchema=objectSchema({path:{type:'string'},code:{type:'string'},message:{type:'string'}},['path','code']);
export const runWorkspaceResultSchema=objectSchema({base_head:{type:'string'},result_head:{type:'string'},checkpoint_sha:{type:'string'},capture_status:{type:'string'},errors:{type:'array',items:workspaceCaptureErrorSchema},updated_at:{type:'string'}},['base_head','capture_status','errors','updated_at']);
const runArtifactSummarySchema=objectSchema({total_count:{type:'integer',minimum:0},project_count:{type:'integer',minimum:0},hidden_count:{type:'integer',minimum:0}},['total_count','project_count','hidden_count']);
const workspaceAttachmentResponseSchema=objectSchema({version_id:{type:'string'},entry_id:{type:'string'},name:{type:'string'},path:{type:'string'},size:{type:'integer',minimum:0},mime_type:{type:'string'},url:{type:'string'},preview_url:{type:'string'}},['version_id','name','path','size','mime_type','url','preview_url']);
const runProjectSchema=objectSchema({id:{type:'string'},name:{type:'string'},path:{type:'string'},availability:{type:'string',enum:['available','unavailable','unknown']}},['id','name','path','availability']);
const timelineRunResponseSchema=objectSchema({
  id:{type:'string'},messageId:{type:'string'},agent:{type:'string'},requestedModel:{type:'string'},harnessInstanceId:{type:'string'},harnessType:{type:'string'},adapterGeneration:{type:'integer',minimum:1},modelId:{type:'string'},executionProfile:runExecutionProfileResponseSchema,recommendedProject:runProjectSchema,status:{type:'string'},upstreamStatus:upstreamStatusResponseSchema,connector:connectorRunStateResponseSchema,usage:{type:'object',additionalProperties:false,required:['inputTokens','outputTokens'],properties:{inputTokens:{type:'integer',minimum:0},outputTokens:{type:'integer',minimum:0},totalTokens:{type:'integer',minimum:0},reasoningTokens:{type:'integer',minimum:0},cacheReadTokens:{type:'integer',minimum:0},cacheWriteTokens:{type:'integer',minimum:0}}},text:{type:'string'},reasoning:{type:'string'},tools:{type:'array',items:toolActivityResponseSchema},retryOfRunId:{type:'string'},continuedFromRunId:{type:'string'},continuationInstruction:{type:'string'},continuationAuthor:humanAuthorSnapshotResponseSchema,continuationRetention:{type:'string',enum:['explicit_release','provider_managed']},responseSlotId:{type:'string'},attemptNumber:{type:'integer',minimum:1},requests:{type:'array',items:runRequestResponseSchema},interventions:{type:'array',items:runInterventionResponseItemSchema},error:{type:'string'},errorCode:{type:'string'},artifacts:{type:'array'},artifactSummary:runArtifactSummarySchema,staticPreview:workspaceAttachmentResponseSchema,staticPreviewStatus:{type:'string',enum:['ready','build_missing','capture_failed']},embeds:{type:'array'},workspaceResult:runWorkspaceResultSchema,
},['id','messageId','agent','harnessInstanceId','harnessType','modelId','executionProfile','status','text','tools','interventions']);
export const roomTimelineResponseSchema=objectSchema({
  messages:{type:'array',items:messageResponseSchema},runs:{type:'array',items:timelineRunResponseSchema},selectedRuns:{type:'object',additionalProperties:{type:'string'}},workflowMode:workflowModeSchema,lastSequence:{type:'integer',minimum:0},hasMore:{type:'boolean'},nextCursor:{type:'string'},
},['messages','runs','selectedRuns','workflowMode','lastSequence','hasMore']);

export const roomListResponseSchema={type:'array',items:roomResponseSchema} as const;
const connectorCatalogModelSchema=objectSchema({id:{type:'string'},label:{type:'string'},reasoningEfforts:{type:'array',items:{type:'string'}},defaultReasoningEffort:nullableStringSchema},['id']);
const connectorCatalogOptionSchema=objectSchema({id:{type:'string'},label:{type:'string'}},['id']);
const connectorExecutionControlsSchema=objectSchema({nativeWorkflowModes:{type:'array',items:workflowModeSchema},permissionProfiles:{type:'array',items:connectorCatalogOptionSchema},agentVariants:{type:'array',items:connectorCatalogOptionSchema}},['nativeWorkflowModes','permissionProfiles','agentVariants']);
const connectorErrorSchema=objectSchema({code:{type:'string'},message:{type:'string'}},['code','message']);
const harnessCacheMetadataSchema=objectSchema({state:{type:'string',enum:['fresh','refreshing','stale']},refreshedAt:nullableStringSchema,expiresAt:nullableStringSchema,error:connectorErrorSchema},['state','refreshedAt','expiresAt']);
const harnessInstanceCacheMetadataSchema=objectSchema({state:{type:'string',enum:['fresh','stale','unavailable']},refreshedAt:nullableStringSchema,error:connectorErrorSchema},['state','refreshedAt']);
const harnessInstanceCatalogSchema=objectSchema({
  id:{type:'string'},type:{type:'string'},status:{type:'string',enum:['healthy','degraded','unavailable']},capabilities:{type:'array',items:{type:'string'}},error:connectorErrorSchema,
  interventionMode:{type:'string',const:'interrupt_then_continue'},
  postTurnContinuation:objectSchema({mode:{type:'string',const:'native_session'},durability:{type:'string',const:'connector_restart'},retention:{type:'string',enum:['explicit_release','provider_managed']}},['mode','durability','retention']),
  models:{type:'array',items:connectorCatalogModelSchema},controls:connectorExecutionControlsSchema,catalogCache:harnessInstanceCacheMetadataSchema,
},['id','type','status','capabilities','models','controls','catalogCache']);
export const harnessCatalogResponseSchema=objectSchema({connectorEpoch:{type:'string'},instances:{type:'array',items:harnessInstanceCatalogSchema},cache:harnessCacheMetadataSchema},['connectorEpoch','instances','cache']);
export const personaListResponseSchema={type:'array',items:personaResponseSchema} as const;
export const personaGroupListResponseSchema={type:'array',items:personaGroupResponseSchema} as const;

function objectSchema(
  properties: Record<string, unknown>,
  required?: readonly string[],
) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required ? { required } : {}),
  } as const;
}
