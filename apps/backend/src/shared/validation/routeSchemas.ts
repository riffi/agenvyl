const nullableStringSchema={anyOf:[{type:'null'},{type:'string'}]} as const;

export const idParamsSchema = objectSchema({ id: { type: 'string' } }, ['id']);
export const roomParamsSchema = objectSchema({ roomId: { type: 'string' } }, ['roomId']);
export const runParamsSchema = objectSchema({ runId: { type: 'string' } }, ['runId']);
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
});

export const renameRoomBodySchema = objectSchema({ title: { type: 'string' } });

export const createPersonaBodySchema = objectSchema({
  handle: { type: 'string' },
  name: { type: 'string' },
  room_id: { type: 'string' },
  role: { type: 'string' },
  color: { type: 'string' },
  requested_model: nullableStringSchema,
  harness_instance_id: { type: 'string' },
  model_id: { type: 'string' },
  mode_id: nullableStringSchema,
  system_prompt: { type: 'string' },
  group_id: nullableStringSchema,
});

export const groupBodySchema=objectSchema({name:{type:'string',maxLength:80}});
export const moveGroupBodySchema=objectSchema({direction:{type:'string',enum:['up','down']}},['direction']);
export const reorderGroupBodySchema=objectSchema({position:{type:'integer',minimum:0}},['position']);

export const updatePersonaBodySchema = {
  type: 'object',
  additionalProperties: true,
  properties: createPersonaBodySchema.properties,
} as const;

export const createMessageBodySchema = objectSchema({
  text: { type: 'string' },
  targets: { type: 'array', items: { type: 'string' } },
  message_id: { type: 'string' },
  attachment_version_ids:{type:'array',items:{type:'string'},maxItems:10},
});

export const userProfileBodySchema=objectSchema({display_name:{type:'string',maxLength:120},handle:{type:'string',maxLength:80}},['display_name','handle']);
export const userProfileResponseSchema=objectSchema({id:{type:'string'},displayName:{type:'string'},handle:{type:'string'},createdAt:{type:'string'},updatedAt:{type:'string'}},['id','displayName','handle','createdAt','updatedAt']);

export const runRequestResolutionBodySchema = objectSchema({ resolution: { type: 'string' } });

export const roomResponseSchema = objectSchema({
  id:{type:'string'},title:{type:'string'},created_at:{type:'string'},participant_count:{type:'integer'},
  last_message_at:nullableStringSchema,last_message_text:nullableStringSchema,
  deleted_at:nullableStringSchema,
},['id','title','created_at','participant_count','last_message_at','last_message_text','deleted_at']);

export const personaGroupResponseSchema=objectSchema({
  id:{type:'string'},name:{type:'string'},position:{type:'integer'},created_at:{type:'string'},updated_at:{type:'string'},
},['id','name','position','created_at','updated_at']);

export const personaResponseSchema=objectSchema({
  id:{type:'string'},handle:{type:'string'},name:{type:'string'},role:{type:'string'},color:{type:'string'},
  requested_model:nullableStringSchema,effective_model:nullableStringSchema,
  harness_instance_id:{type:'string'},harness_type:{type:'string'},model_id:{type:'string'},mode_id:nullableStringSchema,
  current_version_id:{type:'string'},system_prompt:{type:'string'},group_id:nullableStringSchema,
  created_at:{type:'string'},updated_at:{type:'string'},archived_at:nullableStringSchema,
},['id','handle','name','role','color','requested_model','harness_instance_id','harness_type','model_id','mode_id','group_id','archived_at']);

export const messageResponseSchema=objectSchema({
  id:{type:'string'},text:{type:'string'},createdAt:{type:'string'},targets:{type:'array',items:{type:'string'}},runIds:{type:'array',items:{type:'string'}},attachments:{type:'array'},author:objectSchema({profileId:{type:'string'},displayName:{type:'string'},handle:{type:'string'}},['profileId','displayName','handle']),addressedToAll:{type:'boolean'},
},['id','text','createdAt','targets','runIds','attachments','author','addressedToAll']);

const toolActivityResponseSchema=objectSchema({id:{type:'string'},name:{type:'string'},detail:{type:'string'},input:{type:'string'},status:{type:'string',enum:['started','progress','completed']}},['id','name','detail','status']);
const upstreamStatusResponseSchema=objectSchema({state:{type:'string',enum:['waiting_upstream','retrying']},reason:{type:'string'},retryable:{type:'boolean'},attempt:{type:'integer',minimum:0},retryAt:{type:'string'},message:{type:'string'}},['state','reason','retryable']);
const connectorRunStateResponseSchema=objectSchema({state:{type:'string',enum:['active','degraded','terminal','unavailable','lost']},checkpointed:{type:'boolean'}},['state','checkpointed']);
const runRequestResponseSchema=objectSchema({kind:{type:'string',enum:['approval','clarification']},prompt:{type:'string'},choices:{type:'array',items:{type:'string'}},resolved:{type:'string'}},['kind','prompt']);
const timelineRunResponseSchema=objectSchema({
  id:{type:'string'},messageId:{type:'string'},agent:{type:'string'},requestedModel:{type:'string'},harnessInstanceId:{type:'string'},harnessType:{type:'string'},modelId:{type:'string'},modeId:nullableStringSchema,status:{type:'string'},upstreamStatus:upstreamStatusResponseSchema,connector:connectorRunStateResponseSchema,usage:{type:'object',additionalProperties:false,required:['inputTokens','outputTokens'],properties:{inputTokens:{type:'integer',minimum:0},outputTokens:{type:'integer',minimum:0},totalTokens:{type:'integer',minimum:0},reasoningTokens:{type:'integer',minimum:0},cacheReadTokens:{type:'integer',minimum:0},cacheWriteTokens:{type:'integer',minimum:0}}},text:{type:'string'},reasoning:{type:'string'},tools:{type:'array',items:toolActivityResponseSchema},retryOfRunId:{type:'string'},responseSlotId:{type:'string'},attemptNumber:{type:'integer',minimum:1},request:runRequestResponseSchema,error:{type:'string'},errorCode:{type:'string'},artifacts:{type:'array'},embeds:{type:'array'},
},['id','messageId','agent','harnessInstanceId','harnessType','modelId','modeId','status','text','tools']);
export const roomTimelineResponseSchema=objectSchema({
  messages:{type:'array',items:messageResponseSchema},runs:{type:'array',items:timelineRunResponseSchema},selectedRuns:{type:'object',additionalProperties:{type:'string'}},lastSequence:{type:'integer',minimum:0},hasMore:{type:'boolean'},nextCursor:{type:'string'},
},['messages','runs','selectedRuns','lastSequence','hasMore']);

export const roomListResponseSchema={type:'array',items:roomResponseSchema} as const;
const connectorCatalogItemSchema=objectSchema({id:{type:'string'},label:{type:'string'}},['id']);
const connectorErrorSchema=objectSchema({code:{type:'string'},message:{type:'string'}},['code','message']);
const harnessInstanceCatalogSchema=objectSchema({
  id:{type:'string'},type:{type:'string'},status:{type:'string',enum:['healthy','degraded','unavailable']},capabilities:{type:'array',items:{type:'string'}},error:connectorErrorSchema,
  models:{type:'array',items:connectorCatalogItemSchema},modes:{type:'array',items:connectorCatalogItemSchema},
},['id','type','status','capabilities','models','modes']);
export const harnessCatalogResponseSchema=objectSchema({connectorEpoch:{type:'string'},instances:{type:'array',items:harnessInstanceCatalogSchema}},['connectorEpoch','instances']);
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
