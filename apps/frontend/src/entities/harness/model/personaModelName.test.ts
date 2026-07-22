import {describe,expect,it} from 'vitest';
import type {Persona} from '@agenvyl/contracts';
import type {HarnessCatalog} from './types';
import {personaModelName} from './personaModelName';

const persona={harness_instance_id:'local-opencode',model_id:'anthropic/claude-sonnet',requested_model:'stale/model'} as Persona;

describe('personaModelName',()=>{
  it('prefers the discovered catalog label',()=>{
    const catalog={instances:[{id:'local-opencode',models:[{id:'anthropic/claude-sonnet',label:'Claude Sonnet 4'}]}]} as HarnessCatalog;
    expect(personaModelName(persona,catalog)).toBe('Claude Sonnet 4');
  });

  it('falls back to the short saved model id',()=>{
    expect(personaModelName(persona)).toBe('claude-sonnet');
  });
});
