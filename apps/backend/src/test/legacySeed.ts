import type {Database} from '../infrastructure/database/Database.js';

const personas=[
  ['architect','Architect','#3b82f6','sol','Ты архитектор. Анализируй систему, контракты и компромиссы.'],
  ['coder','Coder','#8b5cf6','qwen','Ты разработчик. Предлагай конкретную, проверяемую реализацию.'],
  ['reviewer','Reviewer','#14b8a6','gpt','Ты ревьюер. Ищи риски, регрессии и недоказанные предположения.'],
  ['debugger','Debugger','#f97316','deepseek','Ты специалист по диагностике. Локализуй причины и предлагай проверки.'],
] as const;

export async function seedLegacyTestDatabase(database:Database){
  if((await database.sql`SELECT 1 FROM app_meta WHERE key='initial_seed_complete'`).length)return;
  const now=new Date().toISOString();
  await database.transaction(async tx=>{
    await tx`INSERT INTO rooms(id,title,created_at)VALUES('demo-room','WebSocket архитектура',${now})ON CONFLICT DO NOTHING`;
    for(const[handle,name,color,model,prompt]of personas){const id=`persona-${handle}`,versionId=`${id}-v1`;await tx`INSERT INTO personas(id,handle,name,color,requested_model,effective_model,harness_instance_id,harness_type,model_id,permission_profile_id,agent_variant_id,current_version_id,created_at,updated_at)VALUES(${id},${handle},${name},${color},${model},NULL,'local-hermes','hermes',${model},NULL,NULL,${versionId},${now},${now})ON CONFLICT DO NOTHING`;await tx`INSERT INTO persona_versions(id,persona_id,version,requested_model,system_prompt,created_at,harness_instance_id,harness_type,model_id,permission_profile_id,agent_variant_id)VALUES(${versionId},${id},1,${model},${prompt},${now},'local-hermes','hermes',${model},NULL,NULL)ON CONFLICT DO NOTHING`;await tx`INSERT INTO room_participants(room_id,persona_id) VALUES('demo-room',${id})ON CONFLICT DO NOTHING`;}
    await tx`INSERT INTO app_meta VALUES('initial_seed_complete',${now})ON CONFLICT DO NOTHING`;
    await tx`UPDATE installation_state SET completed_at=COALESCE(completed_at,${now}),first_room_id=COALESCE(first_room_id,'demo-room'),updated_at=${now} WHERE id=true`;
  });
}
