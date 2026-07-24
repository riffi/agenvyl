// @vitest-environment jsdom

import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {HarnessCatalog} from '../../entities/harness';
import type {Persona} from '../../entities/persona';
import type {RoomGateway} from '../../features/room-session';
import {Composer} from './Composer';

const persona:Persona={id:'coder',handle:'coder',name:'Coder',role:'Implementation',color:'#64748b',requested_model:'anthropic/claude-sonnet',harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'anthropic/claude-sonnet',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,group_id:null,archived_at:null};
const cache={state:'fresh' as const,refreshedAt:'2026-07-24T00:00:00.000Z',expiresAt:'2026-07-24T00:05:00.000Z'};
const catalog:HarnessCatalog={connectorEpoch:'epoch',cache,instances:[{id:'local-opencode',type:'opencode',status:'healthy',capabilities:[],models:[{id:'anthropic/claude-sonnet',label:'Claude Sonnet'}],controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[],agentVariants:[]},catalogCache:{state:'fresh',refreshedAt:cache.refreshedAt}}]};
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

  it('uses one-shot Plan for a slash command and sends the cleaned message',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const send=vi.fn<RoomGateway['send']>().mockResolvedValue(sentMessage),updateExecutionProfile=vi.fn(async()=>undefined),localGateway={...gateway,send};
    render(<Composer gateway={localGateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    const editor=screen.getByPlaceholderText('Message… Use @handle or @all');
    fireEvent.change(editor,{target:{value:'/plan @coder inspect'}});fireEvent.keyDown(editor,{key:'Enter'});
    await waitFor(()=>expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.slice(0,2)).toEqual(['@coder inspect',['coder']]);
    expect(send.mock.calls[0]?.[4]).toEqual({kind:'plan'});
    expect(updateExecutionProfile).not.toHaveBeenCalled();
  });

  it('arms Plan only for the next message',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const send=vi.fn<RoomGateway['send']>().mockResolvedValue(sentMessage),updateExecutionProfile=vi.fn(async()=>undefined),localGateway={...gateway,send};
    render(<Composer gateway={localGateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Create plan'}));
    expect(screen.getByRole('button',{name:'Create plan'}).getAttribute('aria-pressed')).toBe('true');
    expect(send).not.toHaveBeenCalled();
    expect(updateExecutionProfile).not.toHaveBeenCalled();
  });

  it('selects implementers and snapshots the approved plan',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const send=vi.fn<RoomGateway['send']>().mockResolvedValue(sentMessage),updateExecutionProfile=vi.fn(async()=>undefined),onSent=vi.fn(async()=>undefined),localGateway={...gateway,send};
    render(<Composer gateway={localGateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={onSent} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} executionState={{plan:{path:'plan.md',current:{entry_id:'plan-entry',version_id:'plan-version'},approved:{entry_id:'plan-entry',version_id:'plan-version'}}}}/>);
    fireEvent.click(screen.getByRole('button',{name:'Implement…'}));
    expect(screen.getByText('Who should implement?')).toBeTruthy();
    expect((screen.getByRole('checkbox',{name:/Coder/}) as HTMLInputElement).checked).toBe(true);
    expect(updateExecutionProfile).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Start with 1 agent'}));
    await waitFor(()=>expect(send).toHaveBeenCalled());
    expect(updateExecutionProfile).not.toHaveBeenCalled();
    expect(send.mock.calls[0]?.slice(0,2)).toEqual(['Implement the approved plan.',['coder']]);
    expect(send.mock.calls[0]?.[2]).toEqual(expect.any(String));
    expect(send.mock.calls[0]?.[3]).toEqual([]);
    expect(send.mock.calls[0]?.[4]).toEqual({kind:'implement',approved_plan_version_id:'plan-version'});
    expect(onSent).toHaveBeenCalled();
    expect((screen.getByPlaceholderText('Message… Use @handle or @all') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows pending plan changes while keeping the approved version executable',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));const openWorkspace=vi.fn(),approvePlan=vi.fn(async()=>undefined);
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={openWorkspace} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} approvePlan={approvePlan} executionState={{plan:{path:'plan.md',current:{entry_id:'plan-entry',version_id:'current-version'},approved:{entry_id:'plan-entry',version_id:'approved-version'}}}}/>);
    fireEvent.click(screen.getByRole('button',{name:/Changes pending/}));expect(openWorkspace).toHaveBeenLastCalledWith({entryId:'plan-entry',versionId:'approved-version'});
    fireEvent.click(screen.getByRole('button',{name:'Open changes'}));expect(openWorkspace).toHaveBeenLastCalledWith({entryId:'plan-entry',versionId:'current-version'});
    fireEvent.click(screen.getByRole('button',{name:'Re-approve'}));expect(approvePlan).toHaveBeenCalledWith('current-version');expect(screen.getByRole('button',{name:'Implement…'})).toBeTruthy();
  });

  it('hides Plan controls and sends /plan as ordinary Work text when disabled',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const send=vi.fn<RoomGateway['send']>().mockResolvedValue(sentMessage),localGateway={...gateway,send};
    render(<Composer gateway={localGateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} planModeEnabled={false} executionState={{plan:{path:'plan.md',current:{entry_id:'plan-entry',version_id:'plan-version'},approved:{entry_id:'plan-entry',version_id:'plan-version'}}}}/>);
    expect(screen.queryByRole('button',{name:'Update plan'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Implement…'})).toBeNull();
    const editor=screen.getByPlaceholderText('Message… Use @handle or @all');
    fireEvent.change(editor,{target:{value:'/plan @coder inspect'}});fireEvent.keyDown(editor,{key:'Enter'});
    await waitFor(()=>expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.slice(0,2)).toEqual(['/plan @coder inspect',['coder']]);
    expect(send.mock.calls[0]?.[4]).toBeUndefined();
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

  it('groups a responder identity and its reasoning control into one chip',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    fireEvent.change(screen.getByPlaceholderText('Message… Use @handle or @all'),{target:{value:'@coder implement'}});
    const responder=screen.getByRole('group',{name:'Responder Coder'});
    expect(responder.textContent).toContain('Coder');
    expect(responder.querySelector('[aria-label^="Reasoning effort:"]')).toBeTruthy();
    expect(responder.querySelector('[aria-label="Remove @coder"]')).toBeTruthy();
  });

  it('opens a ready composer attachment in the shared viewer',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const openArtifact=vi.fn(),file={version_id:'version-notes',entry_id:'entry-notes',path:'notes.md',name:'notes.md',size:24,mime_type:'text/markdown',url:'/notes',preview_url:'/notes/preview'};
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} openArtifact={openArtifact} roomId="room" attachments={[{id:'version-notes',name:'notes.md',size:24,mimeType:'text/markdown',status:'ready',progress:100,attachment:file}]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'notes.md'}));
    expect(openArtifact).toHaveBeenCalledWith(file,[file],expect.any(HTMLElement));
  });
});
