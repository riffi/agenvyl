// @vitest-environment jsdom

import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {render,screen,waitFor} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import type {HarnessCatalog} from '../../entities/harness';
import type {Persona} from '../../entities/persona';
import {PersonasScreen} from './PersonasScreen';

const active:Persona={id:'active',handle:'active',name:'Active agent',role:'Code',color:'#64748b',requested_model:'sol',harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',mode_id:null,group_id:null,archived_at:null};
const archived:Persona={...active,id:'archived',handle:'archived',name:'Archived agent',harness_instance_id:'local-opencode',harness_type:'opencode',archived_at:'2026-07-20T00:00:00.000Z'};
const catalog:HarnessCatalog={connectorEpoch:'epoch',instances:[
  {id:'local-hermes',type:'hermes',status:'healthy',capabilities:[],models:[{id:'sol'}],modes:[]},
  {id:'local-opencode',type:'opencode',status:'healthy',capabilities:[],models:[{id:'sol'}],modes:[]},
]};

describe('persona harness display',()=>{
  it('shows current harnesses in active and archived rows and the editor header',async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const {container}=render(<QueryClientProvider client={client}><PersonasScreen
      personas={[active,archived]}
      harnessCatalog={catalog}
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
    expect(screen.getAllByRole('img',{name:'Hermes'})).toHaveLength(3);
    expect(screen.getByRole('img',{name:'OpenCode'})).toBeTruthy();
    expect(screen.getAllByText('@active · sol')).toHaveLength(2);
    expect(screen.queryByText('@active · Code')).toBeNull();
    expect(screen.getByText('@archived · sol')).toBeTruthy();
  });
});
