import type { Persona } from './types';

export const fakePersonas = [
  { id: 'persona-architect', handle: 'architect', name: 'Architect', requested_model: 'sol', harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',mode_id:null,role: 'Архитектура', color: '#3b82f6', system_prompt: 'Ты архитектор.', group_id:'fake-coding', archived_at: null },
  { id: 'persona-coder', handle: 'coder', name: 'Coder', requested_model: 'qwen', harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'qwen',mode_id:null,role: 'Реализация', color: '#8b5cf6', system_prompt: 'Ты разработчик.', group_id:'fake-coding', archived_at: null },
  { id: 'persona-reviewer', handle: 'reviewer', name: 'Reviewer', requested_model: 'gpt', harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'gpt',mode_id:null,role: 'Ревью', color: '#14b8a6', system_prompt: 'Ты ревьюер.', group_id:'fake-coding', archived_at: null },
  { id: 'persona-debugger', handle: 'debugger', name: 'Debugger', requested_model: 'deepseek', harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'deepseek',mode_id:null,role: 'Диагностика', color: '#f97316', system_prompt: 'Ты специалист по диагностике.', group_id:null, archived_at: null },
] as const satisfies readonly Persona[];
