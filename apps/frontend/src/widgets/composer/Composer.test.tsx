// @vitest-environment jsdom

import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {HarnessCatalog} from '../../entities/harness';
import type {Persona} from '../../entities/persona';
import type {RoomGateway} from '../../features/room-session';
import {Composer} from './Composer';

const persona:Persona={id:'coder',handle:'coder',name:'Coder',role:'Implementation',color:'#64748b',requested_model:'anthropic/claude-sonnet',harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'anthropic/claude-sonnet',permission_profile_id:null,agent_variant_id:null,group_id:null,archived_at:null};
const catalog:HarnessCatalog={connectorEpoch:'epoch',instances:[{id:'local-opencode',type:'opencode',status:'healthy',capabilities:[],models:[{id:'anthropic/claude-sonnet',label:'Claude Sonnet'}],controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[],agentVariants:[]}}]};
const gateway:RoomGateway={mode:'fake',subscribe:vi.fn(()=>vi.fn()),send:vi.fn(),resolve:vi.fn(),cancel:vi.fn(),retry:vi.fn(),select:vi.fn(),dispose:vi.fn()};
const sentMessage={id:'message-1',text:'',createdAt:'2026-07-22T00:00:00.000Z',targets:[],runIds:[],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false};

afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('Composer agent list',()=>{
  it('shows the model rather than the persona role in mention suggestions',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    fireEvent.change(screen.getByPlaceholderText('Message… Use @handle or @all'),{target:{value:'@'}});
    expect(screen.getByRole('listbox',{name:'Select an agent to mention'})).toBeTruthy();
    expect(screen.getByText(/Claude Sonnet/)).toBeTruthy();
    expect(screen.queryByText(/Implementation/)).toBeNull();
  });

  it('persists slash-command mode before sending the cleaned message',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const send=vi.fn<RoomGateway['send']>().mockResolvedValue(sentMessage),updateExecutionProfile=vi.fn(async()=>undefined),localGateway={...gateway,send};
    render(<Composer gateway={localGateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} updateExecutionProfile={updateExecutionProfile}/>);
    const editor=screen.getByPlaceholderText('Message… Use @handle or @all');
    fireEvent.change(editor,{target:{value:'/plan @coder inspect'}});fireEvent.keyDown(editor,{key:'Enter'});
    await waitFor(()=>expect(send).toHaveBeenCalled());
    expect(updateExecutionProfile).toHaveBeenCalledWith({workflow_mode:'plan'});
    expect(send.mock.calls[0]?.slice(0,2)).toEqual(['@coder inspect',['coder']]);
    expect(updateExecutionProfile.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
  });

  it('switches modes with Shift+Tab without sending',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const send=vi.fn<RoomGateway['send']>().mockResolvedValue(sentMessage),updateExecutionProfile=vi.fn(async()=>undefined),localGateway={...gateway,send};
    render(<Composer gateway={localGateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} updateExecutionProfile={updateExecutionProfile}/>);
    fireEvent.keyDown(screen.getByPlaceholderText('Message… Use @handle or @all'),{key:'Tab',shiftKey:true});
    await waitFor(()=>expect(updateExecutionProfile).toHaveBeenCalledWith({workflow_mode:'plan'}));
    expect(send).not.toHaveBeenCalled();
  });

  it('selects implementers before switching to Work and starting the approved plan',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const send=vi.fn<RoomGateway['send']>().mockResolvedValue(sentMessage),updateExecutionProfile=vi.fn(async()=>undefined),onSent=vi.fn(async()=>undefined),localGateway={...gateway,send};
    render(<Composer gateway={localGateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={onSent} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} updateExecutionProfile={updateExecutionProfile} executionState={{profile:{workflow_mode:'plan',reasoning_effort:null},approved_plan:{run_id:'plan-1',agent:'coder',created_at:'2026-07-22T00:00:00.000Z',excerpt:'A concrete plan'}}}/>);
    fireEvent.click(screen.getByRole('button',{name:'Implement…'}));
    expect(screen.getByText('Who should implement?')).toBeTruthy();
    expect((screen.getByRole('checkbox',{name:/Coder/}) as HTMLInputElement).checked).toBe(true);
    expect(updateExecutionProfile).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Start with 1 agent'}));
    await waitFor(()=>expect(send).toHaveBeenCalled());
    expect(updateExecutionProfile).toHaveBeenCalledWith({workflow_mode:'work'});
    expect(send.mock.calls[0]?.slice(0,2)).toEqual(['Implement the approved plan.',['coder']]);
    expect(send.mock.calls[0]?.[2]).toEqual(expect.any(String));
    expect(send.mock.calls[0]?.[3]).toEqual([]);
    expect(updateExecutionProfile.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    expect(onSent).toHaveBeenCalled();
    expect((screen.getByPlaceholderText('Message… Use @handle or @all') as HTMLTextAreaElement).value).toBe('');
  });

  it('distinguishes room posts from messages addressed to agents',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    const editor=screen.getByPlaceholderText('Message… Use @handle or @all');
    fireEvent.change(editor,{target:{value:'Status update'}});
    expect(screen.getByRole('button',{name:'Post to room'})).toBeTruthy();
    expect(screen.getByText(/No responders · posts to room/)).toBeTruthy();
    fireEvent.change(editor,{target:{value:'@coder implement'}});
    expect(screen.getByRole('button',{name:'Send to 1 agent'})).toBeTruthy();
  });
});
