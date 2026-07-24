// @vitest-environment jsdom

import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {HarnessCatalog} from '../../entities/harness';
import type {Persona} from '../../entities/persona';
import {PersonasScreen} from './PersonasScreen';

const active:Persona={id:'active',handle:'active',name:'Active agent',color:'#64748b',requested_model:'sol',harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,group_id:null,archived_at:null};
const archived:Persona={...active,id:'archived',handle:'archived',name:'Archived agent',harness_instance_id:'local-opencode',harness_type:'opencode',archived_at:'2026-07-20T00:00:00.000Z'};
const cache={state:'fresh' as const,refreshedAt:'2026-07-24T00:00:00.000Z',expiresAt:'2026-07-24T00:05:00.000Z'};
const catalog:HarnessCatalog={connectorEpoch:'epoch',cache,instances:[
  {id:'local-hermes',type:'hermes',status:'healthy',capabilities:[],models:[{id:'sol'}],controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]},catalogCache:{state:'fresh',refreshedAt:cache.refreshedAt}},
  {id:'local-opencode',type:'opencode',status:'healthy',capabilities:[],models:[{id:'sol'}],controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[],agentVariants:[]},catalogCache:{state:'fresh',refreshedAt:cache.refreshedAt}},
]};

afterEach(cleanup);

describe('persona harness display',()=>{
  it('shows current harnesses in active and archived rows and the editor header',async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const {container}=render(<QueryClientProvider client={client}><PersonasScreen
      personas={[active,archived]}
      harnessCatalog={catalog}
      harnessRefreshing={false}
      onRefreshHarness={vi.fn(async()=>undefined)}
      groups={[]}
      loading={false}
      onChanged={vi.fn(async()=>undefined)}
      real={false}
      roomId="demo-room"
      roomPersonaIds={new Set()}
      selectedPersonaId={active.id}
      onSelectPersona={vi.fn()}
      openMenu={vi.fn()}
      registerNavigationGuard={vi.fn()}
    /></QueryClientProvider>);

    await waitFor(()=>expect(container.querySelector('[data-harness-size="md"][data-harness-type="hermes"]')).toBeTruthy());
    expect(screen.queryByText('Archive')).toBeNull();
    expect(screen.queryByText('Archived agent')).toBeNull();
    expect(screen.queryByText(/active · \d+ archived/i)).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Show or hide archive'}));
    expect(screen.getByText('Archive')).toBeTruthy();
    expect(screen.getByText('Archived agent')).toBeTruthy();
    expect(screen.getAllByRole('img',{name:'Hermes'})).toHaveLength(3);
    expect(screen.getByRole('img',{name:'OpenCode'})).toBeTruthy();
    expect(screen.getAllByText('@active · sol')).toHaveLength(2);
    expect(screen.queryByText('@active · Code')).toBeNull();
    expect(screen.getByText('@archived · sol')).toBeTruthy();
  });

  it('shows stale data without blocking an explicit refresh',()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),refresh=vi.fn(async()=>undefined);
    render(<QueryClientProvider client={client}><PersonasScreen
      personas={[active]}
      harnessCatalog={{...catalog,cache:{...catalog.cache,state:'stale',error:{code:'connector_unavailable',message:'Refresh failed'}}}}
      harnessRefreshing={false}
      onRefreshHarness={refresh}
      groups={[]}
      loading={false}
      onChanged={vi.fn(async()=>undefined)}
      real
      roomId="demo-room"
      roomPersonaIds={new Set()}
      onSelectPersona={vi.fn()}
      openMenu={vi.fn()}
      registerNavigationGuard={vi.fn()}
    /></QueryClientProvider>);
    expect(screen.getByRole('alert').textContent).toContain('Previously loaded models');
    expect(screen.getByRole('alert').textContent).toContain('Click Refresh to try again');
    const button=screen.getByRole('button',{name:'Refresh harness models'});
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('uses a friendly harness name and an explicit recovery action for stale instances',()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const staleClaude:HarnessCatalog['instances'][number]={id:'local-claude',type:'claude',status:'degraded',capabilities:[],models:[{id:'opus'}],controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]},catalogCache:{state:'stale',refreshedAt:cache.refreshedAt}};
    render(<QueryClientProvider client={client}><PersonasScreen
      personas={[active]}
      harnessCatalog={{...catalog,instances:[staleClaude]}}
      harnessRefreshing={false}
      onRefreshHarness={vi.fn(async()=>undefined)}
      groups={[]}
      loading={false}
      onChanged={vi.fn(async()=>undefined)}
      real
      roomId="demo-room"
      roomPersonaIds={new Set()}
      onSelectPersona={vi.fn()}
      openMenu={vi.fn()}
      registerNavigationGuard={vi.fn()}
    /></QueryClientProvider>);
    const warning=screen.getByRole('alert').textContent??'';
    expect(warning).toContain('updated Claude models');
    expect(warning).toContain('Click Refresh to try again');
    expect(warning).not.toContain('local-claude');
    expect(warning).not.toContain('catalog');
  });
});
