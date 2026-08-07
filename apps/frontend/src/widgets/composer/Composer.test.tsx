// @vitest-environment jsdom

import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {HarnessCatalog} from '../../entities/harness';
import type {Persona} from '../../entities/persona';
import type {RoomGateway} from '../../features/room-session';
import {Composer} from './Composer';

const persona:Persona={id:'coder',handle:'coder',name:'Coder',color:'#64748b',requested_model:'anthropic/claude-sonnet',harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'anthropic/claude-sonnet',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,group_id:null,archived_at:null};
const cache={state:'fresh' as const,refreshedAt:'2026-07-24T00:00:00.000Z',expiresAt:'2026-07-24T00:05:00.000Z'};
const catalog:HarnessCatalog={connectorEpoch:'epoch',cache,instances:[{id:'local-opencode',type:'opencode',status:'healthy',capabilities:[],models:[{id:'anthropic/claude-sonnet',label:'Claude Sonnet'}],controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[],agentVariants:[]},catalogCache:{state:'fresh',refreshedAt:cache.refreshedAt}}]};
const gateway:RoomGateway={mode:'fake',subscribe:vi.fn(()=>vi.fn()),send:vi.fn(),resolve:vi.fn(),intervene:vi.fn(),cancel:vi.fn(),retry:vi.fn(),select:vi.fn(),dispose:vi.fn()};
const sentMessage={id:'message-1',text:'',createdAt:'2026-07-22T00:00:00.000Z',targets:[],runIds:[],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false};

afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('Composer agent list',()=>{
  it('preserves the normal draft while submitting a text-only redirect',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));const intervene=vi.fn(async()=>undefined),exitIntervention=vi.fn(),redirectGateway={...gateway,intervene};
    const props={gateway:redirectGateway,active:1,personas:[persona],harnessCatalog:catalog,catalogReady:true,onSent:vi.fn(async()=>undefined),openWorkspace:vi.fn(),roomId:'room',attachments:[],attachmentsBusy:false,openAttachmentPicker:vi.fn(),uploadFiles:vi.fn(),removeAttachment:vi.fn(),retryAttachment:vi.fn(),clearAttachments:vi.fn()};
    const view=render(<Composer {...props}/>);fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'Ordinary draft'}});
    view.rerender(<Composer {...props} interventionTarget={{runId:'run-1',agent:'coder',active:true}} exitIntervention={exitIntervention}/>);
    const editor=screen.getByRole('textbox',{name:'Redirect coder'}),redirectButton=screen.getByRole('button',{name:'Redirect run'}),redirectFooter=redirectButton.closest('footer');expect(editor.getAttribute('maxlength')).toBe('2000');expect((editor as HTMLTextAreaElement).value).toBe('');expect(screen.queryByRole('button',{name:'Add to message'})).toBeNull();expect(redirectFooter?.children).toHaveLength(2);
    fireEvent.change(editor,{target:{value:'Focus on the API'}});fireEvent.click(screen.getByRole('button',{name:'Redirect run'}));
    await waitFor(()=>expect(intervene).toHaveBeenCalledWith('run-1','Focus on the API'));expect(exitIntervention).toHaveBeenCalledOnce();
    view.rerender(<Composer {...props}/>);expect((screen.getByRole('textbox',{name:'Message'}) as HTMLTextAreaElement).value).toBe('Ordinary draft');
  });

  it('keeps the redirect draft when the run has already finished',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));const intervene=vi.fn(),redirectGateway={...gateway,intervene};
    render(<Composer gateway={redirectGateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} interventionTarget={{runId:'run-1',agent:'coder',active:false}}/>);
    const editor=screen.getByRole('textbox',{name:'Redirect coder'});fireEvent.change(editor,{target:{value:'Still useful'}});fireEvent.click(screen.getByRole('button',{name:'Redirect run'}));
    expect(intervene).not.toHaveBeenCalled();expect(await screen.findByText(/run has already finished/)).toBeTruthy();expect((editor as HTMLTextAreaElement).value).toBe('Still useful');
  });
  it('shows the model in mention suggestions',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'@'}});
    expect(screen.getByRole('listbox',{name:'Select an agent to mention'})).toBeTruthy();
    expect(screen.getByText(/Claude Sonnet/)).toBeTruthy();
    expect(screen.queryByText(/Implementation/)).toBeNull();
  });

  it('persists Plan through the room workflow callback and does not send a message',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const send=vi.fn<RoomGateway['send']>().mockResolvedValue(sentMessage),updateWorkflowMode=vi.fn(async()=>undefined),localGateway={...gateway,send};
    render(<Composer gateway={localGateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} workflowMode="work" updateWorkflowMode={updateWorkflowMode}/>);
    fireEvent.click(screen.getByRole('button',{name:'Plan'}));
    await waitFor(()=>expect(updateWorkflowMode).toHaveBeenCalledWith('plan'));
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps Plan active after sending to multiple responders',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const second={...persona,id:'reviewer',handle:'reviewer',name:'Reviewer'},send=vi.fn<RoomGateway['send']>().mockResolvedValue(sentMessage),localGateway={...gateway,send};
    const {rerender}=render(<Composer gateway={localGateway} active={0} personas={[persona,second]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} workflowMode="plan"/>);
    const editor=screen.getByRole('textbox',{name:'Message'});
    fireEvent.change(editor,{target:{value:'@all inspect this'}});fireEvent.keyDown(editor,{key:'Enter'});
    await waitFor(()=>expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.slice(0,2)).toEqual(['@all inspect this',['coder','reviewer']]);
    rerender(<Composer gateway={localGateway} active={0} personas={[persona,second]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} workflowMode="plan"/>);
    expect(screen.getByRole('button',{name:'Plan'}).getAttribute('aria-pressed')).toBe('true');
  });

  it('warns when a selected harness has instruction-only Plan enforcement',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const hermes={...persona,harness_instance_id:'local-hermes',harness_type:'hermes' as const},hermesCatalog:HarnessCatalog={connectorEpoch:'epoch',cache,instances:[{id:'local-hermes',type:'hermes',status:'healthy',capabilities:[],models:[{id:'anthropic/claude-sonnet'}],controls:{nativeWorkflowModes:['work'],permissionProfiles:[],agentVariants:[]},catalogCache:{state:'fresh',refreshedAt:cache.refreshedAt}}]};
    render(<Composer gateway={gateway} active={0} personas={[hermes]} harnessCatalog={hermesCatalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} workflowMode="plan"/>);
    const editor=screen.getByRole('textbox',{name:'Message'});
    fireEvent.change(editor,{target:{value:'@coder inspect'}});
    expect(screen.getByText(/does not technically block writes to the external project/i)).toBeTruthy();
    expect(screen.getByText(/Instruction-only Plan/)).toBeTruthy();
  });

  it('distinguishes room posts from messages addressed to agents',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    const editor=screen.getByRole('textbox',{name:'Message'});
    fireEvent.change(editor,{target:{value:'Status update'}});
    expect(screen.getByRole('button',{name:'Post to room'})).toBeTruthy();
    expect(screen.getByText(/Posts to room — no agents invoked/)).toBeTruthy();
    fireEvent.change(editor,{target:{value:'@coder implement'}});
    expect(screen.getByRole('button',{name:'Send to 1 agent'})).toBeTruthy();
  });

  it('keeps the unavailable catalog empty state compact until typing starts',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady={false} onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    const editor=screen.getByRole('textbox',{name:'Message'});
    expect(editor.getAttribute('placeholder')).toBe('Agent catalog unavailable');
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('button',{name:'Post to room'}).hasAttribute('disabled')).toBe(true);
    fireEvent.change(editor,{target:{value:'Draft message'}});
    expect(editor.getAttribute('placeholder')).toBe('Message @handle or @all…');
    expect(screen.getByRole('status').textContent).toBe('Agent catalog unavailable');
  });

  it('caps the expanded text area above the fixed controls row',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    const editor=screen.getByRole('textbox',{name:'Message'});
    Object.defineProperty(editor,'scrollHeight',{configurable:true,value:500});
    fireEvent.change(editor,{target:{value:'A long draft'}});
    await waitFor(()=>expect((editor as HTMLTextAreaElement).style.height).toBe('168px'));
  });

  it('groups a responder identity and its reasoning control into one chip',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'@coder implement'}});
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

  it('opens the add menu and routes its actions',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const openAttachmentPicker=vi.fn(),openWorkspace=vi.fn();
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={openWorkspace} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={openAttachmentPicker} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Add to message'}));
    expect(screen.getByRole('menu',{name:'Add to message'})).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem',{name:/Attach files/}));
    expect(openAttachmentPicker).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button',{name:'Add to message'}));
    fireEvent.click(screen.getByRole('menuitem',{name:/Open workspace/}));
    expect(openWorkspace).toHaveBeenCalledOnce();
  });

  it('supports keyboard navigation in the add menu',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    const trigger=screen.getByRole('button',{name:'Add to message'});
    trigger.focus();
    fireEvent.keyDown(trigger,{key:'ArrowDown'});
    const firstItem=screen.getByRole('menuitem',{name:/Attach files/});
    await waitFor(()=>expect(document.activeElement).toBe(firstItem));
    fireEvent.keyDown(firstItem,{key:'Escape'});
    expect(screen.queryByRole('menu',{name:'Add to message'})).toBeNull();
    await waitFor(()=>expect(document.activeElement).toBe(trigger));
  });
});
