// @vitest-environment jsdom

import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {HarnessCatalog} from '../../entities/harness';
import type {Persona} from '../../entities/persona';
import {HarnessRouteFields,PersonaInstructionFields} from './PersonasScreen';

const cache={state:'fresh' as const,refreshedAt:'2026-07-24T00:00:00.000Z',expiresAt:'2026-07-24T00:05:00.000Z'};
const catalog:HarnessCatalog={connectorEpoch:'epoch-1',cache,instances:[
  {id:'local-hermes',type:'hermes',status:'healthy',capabilities:['model_catalog'],models:[{id:'sol',label:'Sonnet'}],controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]},catalogCache:{state:'fresh',refreshedAt:cache.refreshedAt}},
  {id:'local-opencode',type:'opencode',status:'healthy',capabilities:['model_catalog'],models:[{id:'gpt-5',label:'GPT-5'}],controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[{id:'standard',label:'Standard'},{id:'auto-approve',label:'Auto-approve'}],agentVariants:[{id:'build',label:'Build'},{id:'plan',label:'Plan'}]},catalogCache:{state:'fresh',refreshedAt:cache.refreshedAt}},
]};
const persona=(patch:Partial<Persona>={}):Persona=>({id:'persona-1',handle:'coder',name:'Coder',role:'Code',color:'#64748b',requested_model:'sol',harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,group_id:null,archived_at:null,...patch});

afterEach(cleanup);

describe('persona harness route fields',()=>{
  it('renders persona instructions as a collapsed disclosure by default',()=>{
    const html=renderToStaticMarkup(<PersonaInstructionFields value="Be precise" onChange={vi.fn()}/>);
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open=""');
    expect(html).toContain('System prompt and behavior rules');
  });
  it('renders the Hermes instance and model without a mode selector',()=>{
    const html=renderToStaticMarkup(<HarnessRouteFields form={persona()} catalog={catalog} onChange={vi.fn()}/>);
    expect(html).toContain('<strong>local-hermes</strong>');
    expect(html).toContain('<small>hermes</small>');
    expect(html).toContain('Sonnet');
    expect(html).not.toContain('Harness mode');
  });

  it('shows harness icons in the instance trigger and options',()=>{
    render(<HarnessRouteFields form={persona()} catalog={catalog} onChange={vi.fn()}/>);
    expect(screen.getByRole('img',{name:'Hermes'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Harness instance'}));
    expect(screen.getByRole('listbox',{name:'Available harness instances'})).toBeTruthy();
    expect(screen.getAllByRole('img',{name:'Hermes'})).toHaveLength(2);
    expect(screen.getByRole('img',{name:'OpenCode'})).toBeTruthy();
  });

  it('renders OpenCode models and provider agent variants',()=>{
    const html=renderToStaticMarkup(<HarnessRouteFields form={persona({requested_model:'gpt-5',harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'gpt-5',agent_variant_id:'build'})} catalog={catalog} onChange={vi.fn()}/>);
    expect(html).toContain('GPT-5');
    expect(html).toContain('Agent variant');
    expect(html).toContain('Build');
    expect(html).toContain('Plan');
  });

  it('warns when an OpenCode persona selects Auto-approve',()=>{
    const html=renderToStaticMarkup(<HarnessRouteFields form={persona({requested_model:'gpt-5',harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'gpt-5',permission_profile_id:'auto-approve'})} catalog={catalog} onChange={vi.fn()}/>);
    expect(html).toContain('Auto-approve confirms every OpenCode permission');
    expect(html).toContain('External paths remain limited');
  });

  it('shows AGY permissions without exposing room workflow state',()=>{
    const agyCatalog:HarnessCatalog={connectorEpoch:'agy',cache,instances:[{id:'local-antigravity',type:'antigravity',status:'healthy',capabilities:['model_catalog'],models:[{id:'gemini'}],controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[{id:'accept-edits',label:'Accept edits'}],agentVariants:[]},catalogCache:{state:'fresh',refreshedAt:cache.refreshedAt}}]};
    const html=renderToStaticMarkup(<HarnessRouteFields form={persona({harness_instance_id:'local-antigravity',harness_type:'antigravity',model_id:'gemini',requested_model:'gemini',permission_profile_id:'accept-edits'})} catalog={agyCatalog} onChange={vi.fn()}/>);
    expect(html).toContain('Permissions');
    expect(html).not.toContain('Harness mode');
    expect(html).toContain('Accept edits');
  });

  it('keeps a saved route visible when discovery is unavailable',()=>{
    const html=renderToStaticMarkup(<HarnessRouteFields form={persona()} error="Connector offline" onChange={vi.fn()}/>);
    expect(html).toContain('Connector offline');
    expect(html).toContain('<strong>local-hermes</strong>');
    expect(html).toContain('<small>hermes · unavailable</small>');
    expect(html).toContain('sol (saved)');
  });

  it('keeps a same-epoch stale catalog selectable while the runtime is unavailable',()=>{
    const staleCatalog:HarnessCatalog={...catalog,instances:[{
      ...catalog.instances[0],
      status:'unavailable',
      catalogCache:{state:'stale',refreshedAt:cache.refreshedAt,error:{code:'catalog_unavailable',message:'Refresh failed'}},
    }]};
    render(<HarnessRouteFields form={persona()} catalog={staleCatalog} onChange={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Harness instance'}));
    expect((screen.getByRole('option',{name:/local-hermes/}) as HTMLButtonElement).disabled).toBe(false);
  });
});
