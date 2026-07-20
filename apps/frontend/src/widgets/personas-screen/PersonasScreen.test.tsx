import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import type {HarnessCatalog} from '../../entities/harness';
import type {Persona} from '../../entities/persona';
import {HarnessRouteFields} from './PersonasScreen';

const catalog:HarnessCatalog={connectorEpoch:'epoch-1',instances:[
  {id:'local-hermes',type:'hermes',status:'healthy',capabilities:['model_catalog'],models:[{id:'sol',label:'Sonnet'}],modes:[]},
  {id:'local-opencode',type:'opencode',status:'healthy',capabilities:['model_catalog','mode_catalog'],models:[{id:'gpt-5',label:'GPT-5'}],modes:[{id:'build',label:'Build'},{id:'plan',label:'Plan'}]},
]};
const persona=(patch:Partial<Persona>={}):Persona=>({id:'persona-1',handle:'coder',name:'Coder',role:'Code',color:'#64748b',requested_model:'sol',harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',mode_id:null,group_id:null,archived_at:null,...patch});

describe('persona harness route fields',()=>{
  it('renders the Hermes instance and model without a mode selector',()=>{
    const html=renderToStaticMarkup(<HarnessRouteFields form={persona()} catalog={catalog} onChange={vi.fn()}/>);
    expect(html).toContain('local-hermes · hermes');
    expect(html).toContain('Sonnet');
    expect(html).not.toContain('Режим harness');
  });

  it('renders OpenCode models and optional modes for an OpenCode persona',()=>{
    const html=renderToStaticMarkup(<HarnessRouteFields form={persona({requested_model:'gpt-5',harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'gpt-5',mode_id:'build'})} catalog={catalog} onChange={vi.fn()}/>);
    expect(html).toContain('GPT-5');
    expect(html).toContain('Режим harness');
    expect(html).toContain('Build');
    expect(html).toContain('Plan');
  });

  it('keeps a saved route visible when discovery is unavailable',()=>{
    const html=renderToStaticMarkup(<HarnessRouteFields form={persona()} error="Connector offline" onChange={vi.fn()}/>);
    expect(html).toContain('Connector offline');
    expect(html).toContain('local-hermes · hermes · unavailable');
    expect(html).toContain('sol (сохранено)');
  });
});
