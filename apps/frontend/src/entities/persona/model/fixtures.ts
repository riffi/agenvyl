import type { Persona } from './types';

export const fakePersonas = [
  { id: 'persona-architect', handle: 'architect', name: 'Architect', requested_model: 'sol', harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,color: '#3b82f6', system_prompt: 'You are a software architect.', group_id:'fake-coding', archived_at: null },
  { id: 'persona-coder', handle: 'coder', name: 'Coder', requested_model: 'qwen', harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'qwen',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,color: '#8b5cf6', system_prompt: 'You are a software developer.', group_id:'fake-coding', archived_at: null },
  { id: 'persona-reviewer', handle: 'reviewer', name: 'Reviewer', requested_model: 'gpt', harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'gpt',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,color: '#14b8a6', system_prompt: 'You are a code reviewer.', group_id:'fake-coding', archived_at: null },
  { id: 'persona-debugger', handle: 'debugger', name: 'Debugger', requested_model: 'deepseek', harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'deepseek',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,color: '#f97316', system_prompt: 'You are a debugging specialist.', group_id:null, archived_at: null },
] as const satisfies readonly Persona[];
