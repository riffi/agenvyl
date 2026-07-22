// @vitest-environment jsdom

import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Persona} from '../../entities/persona';
import {CreateRoomDialog,RoomAgentManager} from './RoomDialogs';

const hermes:Persona={id:'hermes',handle:'hermes',name:'Hermes agent',role:'Code',color:'#64748b',requested_model:'sol',harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',permission_profile_id:null,agent_variant_id:null,group_id:null,archived_at:null};
const openCode:Persona={...hermes,id:'opencode',handle:'opencode',name:'OpenCode agent',harness_instance_id:'local-opencode',harness_type:'opencode'};

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
    render(<RoomAgentManager personas={[hermes,openCode]} groups={[]} roomPersonas={[openCode]} onClose={vi.fn()} onSave={vi.fn()}/>);
    expect(screen.getByRole('img',{name:'Hermes'})).toBeTruthy();
    expect(screen.getByRole('img',{name:'OpenCode'})).toBeTruthy();
    expect(screen.getByText('@opencode · sol')).toBeTruthy();
  });
});
