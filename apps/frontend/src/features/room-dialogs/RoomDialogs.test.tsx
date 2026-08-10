// @vitest-environment jsdom

import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Persona} from '../../entities/persona';
import type {HarnessCatalog} from '../../entities/harness';
import type {LocalProject} from '@agenvyl/contracts';
import {CreateRoomDialog,RoomAgentManager} from './RoomDialogs';

const hermes:Persona={id:'hermes',handle:'hermes',name:'Hermes agent',color:'#64748b',requested_model:'sol',harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,group_id:null,archived_at:null};
const openCode:Persona={...hermes,id:'opencode',handle:'opencode',name:'OpenCode agent',harness_instance_id:'local-opencode',harness_type:'opencode'};
const cache={state:'fresh' as const,refreshedAt:'2026-07-24T00:00:00.000Z',expiresAt:'2026-07-24T00:05:00.000Z'};
const catalog:HarnessCatalog={connectorEpoch:'epoch',cache,instances:[{id:'local-opencode',type:'opencode',status:'healthy',capabilities:[],models:[{id:'sol',reasoningEfforts:['low','high'],defaultReasoningEffort:'low'}],controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]},catalogCache:{state:'fresh',refreshedAt:cache.refreshedAt}}]};
const project:LocalProject={id:'project-1',name:'beautiful-landscape',path:'C:\\work\\beautiful-landscape',availability:'available',created_at:'2026-08-05T00:00:00.000Z',updated_at:'2026-08-05T00:00:00.000Z'};

afterEach(cleanup);

describe('room agent pickers',()=>{
  it('shows harness icons when creating a room',()=>{
    render(<CreateRoomDialog personas={[hermes,openCode]} groups={[]} onClose={vi.fn()} onCreated={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:/Ungrouped/}));
    expect(screen.getByRole('img',{name:'Hermes'})).toBeTruthy();
    expect(screen.getByRole('img',{name:'OpenCode'})).toBeTruthy();
    expect(screen.getByText('@hermes · sol')).toBeTruthy();
    expect(screen.queryByText(/· Code$/)).toBeNull();
  });

  it('shows harness icons when managing current room agents',()=>{
    render(<RoomAgentManager personas={[hermes,openCode]} groups={[]} roomPersonas={[{persona:openCode,reasoning_effort_override:null}]} onUpdateReasoning={vi.fn()} onClose={vi.fn()} onSave={vi.fn()}/>);
    expect(screen.getByRole('img',{name:'Hermes'})).toBeTruthy();
    expect(screen.getByRole('img',{name:'OpenCode'})).toBeTruthy();
    expect(screen.getByText('@opencode · sol')).toBeTruthy();
  });

  it('reveals the optional project field on demand',()=>{
    render(<CreateRoomDialog personas={[]} groups={[]} projects={[project]} onClose={vi.fn()} onCreated={vi.fn()}/>);
    expect(screen.queryByRole('combobox',{name:'Project'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Add project'}));
    expect(screen.getByRole('combobox',{name:'Project'})).toBeTruthy();
    expect(screen.queryByText('Recommended project')).toBeNull();
  });

  it('creates a room without asking for a name',async()=>{
    const onCreated=vi.fn().mockResolvedValue(undefined);
    render(<CreateRoomDialog personas={[]} groups={[]} onClose={vi.fn()} onCreated={onCreated}/>);
    expect(screen.queryByRole('textbox',{name:/name/i})).toBeNull();
    expect(screen.getByText('Choose agents and optionally a project. The room will be named from your first message.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'Add project'}));
    fireEvent.click(screen.getByRole('button',{name:'Create room'}));
    await waitFor(()=>expect(onCreated).toHaveBeenCalledWith([],null));
  });

  it('updates a room override immediately from the reusable effort chip',async()=>{
    const onUpdateReasoning=vi.fn().mockResolvedValue(undefined);
    render(<RoomAgentManager personas={[openCode]} catalog={catalog} groups={[]} roomPersonas={[{persona:openCode,reasoning_effort_override:null}]} onUpdateReasoning={onUpdateReasoning} onClose={vi.fn()} onSave={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:/low/i}));
    expect(screen.getByRole('menu').parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole('menuitemradio',{name:/high/i}));
    expect(onUpdateReasoning).toHaveBeenCalledWith('opencode','high');
  });
});
