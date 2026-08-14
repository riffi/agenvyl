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
const gateway:RoomGateway={mode:'fake',subscribe:vi.fn(()=>vi.fn()),send:vi.fn(),applyQueuedNow:vi.fn(),resolve:vi.fn(),intervene:vi.fn(),cancel:vi.fn(),retry:vi.fn(),select:vi.fn(),dispose:vi.fn()};
const sentMessage={id:'message-1',text:'',createdAt:'2026-07-22T00:00:00.000Z',targets:[],runIds:[],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false};

afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('Composer agent list',()=>{
  it('hides the legacy agent-session mode and safely restores Auto',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const send=vi.fn<RoomGateway['send']>().mockResolvedValue(sentMessage),updateConversationRouting=vi.fn(async()=>undefined),localGateway={...gateway,send};
    render(<Composer gateway={localGateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} conversationRouting conversationRoutingMode="agent_session" updateConversationRouting={updateConversationRouting}/>);
    await waitFor(()=>expect(updateConversationRouting).toHaveBeenCalledWith('auto'));
    fireEvent.click(screen.getByRole('button',{name:/Auto/i}));
    expect(screen.queryByText('Agent session')).toBeNull();
    expect(screen.queryByText('New request')).toBeNull();
    expect(screen.queryByRole('combobox',{name:'Agent session recipient'})).toBeNull();
    const editor=screen.getByRole('textbox',{name:'Message'});fireEvent.change(editor,{target:{value:'Continue the review'}});fireEvent.keyDown(editor,{key:'Enter'});
    await waitFor(()=>expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[4]).toEqual({mode:'auto',delivery:'after_response'});
  });

  it('shows a queued message above the composer and applies that message now',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const applyQueuedNow=vi.fn(async()=>undefined),localGateway={...gateway,applyQueuedNow},queuedMessage={...sentMessage,id:'queued-message',text:'Use the existing parser',targets:['coder'],delivery:{route:'agent_session' as const,status:'queued' as const,agent:'coder',anchorRunId:'run-1'}};
    render(<Composer gateway={localGateway} active={1} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} conversationRouting pendingFollowUps={[queuedMessage]}/>);
    expect(screen.getByRole('region',{name:'Queued messages'}).textContent).toContain('Use the existing parser');
    fireEvent.click(screen.getByRole('button',{name:'Apply queued message to Coder now'}));
    await waitFor(()=>expect(applyQueuedNow).toHaveBeenCalledWith('queued-message'));
  });
  it('preserves the normal draft while submitting a text-only instruction',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));const intervene=vi.fn(async()=>undefined),exitIntervention=vi.fn(),instructionGateway={...gateway,intervene};
    const props={gateway:instructionGateway,active:1,personas:[persona],harnessCatalog:catalog,catalogReady:true,onSent:vi.fn(async()=>undefined),openWorkspace:vi.fn(),roomId:'room',attachments:[],attachmentsBusy:false,openAttachmentPicker:vi.fn(),uploadFiles:vi.fn(),removeAttachment:vi.fn(),retryAttachment:vi.fn(),clearAttachments:vi.fn()};
    const view=render(<Composer {...props}/>);fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'Ordinary draft'}});
    view.rerender(<Composer {...props} interventionTarget={{runId:'run-1',agent:'coder',mode:'active_redirect'}} exitIntervention={exitIntervention}/>);
    const editor=screen.getByRole('textbox',{name:'Instruction for coder'}),instructionButton=screen.getByRole('button',{name:'Send instruction'}),instructionFooter=instructionButton.closest('footer');expect(editor.getAttribute('maxlength')).toBe('2000');expect((editor as HTMLTextAreaElement).value).toBe('');expect(editor.getAttribute('placeholder')).toBe('Add an instruction for @coder…');expect(screen.queryByRole('button',{name:'Add to message'})).toBeNull();expect(instructionFooter?.children).toHaveLength(2);expect(instructionFooter?.firstElementChild?.getAttribute('aria-hidden')).toBe('true');expect(screen.queryByRole('status')).toBeNull();expect(instructionFooter?.parentElement?.className).toContain('compose-card-expanded');
    fireEvent.change(editor,{target:{value:'Focus on the API'}});fireEvent.click(screen.getByRole('button',{name:'Send instruction'}));
    await waitFor(()=>expect(intervene).toHaveBeenCalledWith('run-1','Focus on the API'));expect(exitIntervention).toHaveBeenCalledOnce();
    view.rerender(<Composer {...props}/>);expect((screen.getByRole('textbox',{name:'Message'}) as HTMLTextAreaElement).value).toBe('Ordinary draft');
  });

  it('submits an instruction as a post-turn continuation',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));const intervene=vi.fn(async()=>undefined),instructionGateway={...gateway,intervene};
    render(<Composer gateway={instructionGateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} interventionTarget={{runId:'run-1',agent:'coder',mode:'post_turn_continuation'}}/>);
    const editor=screen.getByRole('textbox',{name:'Instruction for coder'});fireEvent.change(editor,{target:{value:'Still useful'}});fireEvent.click(screen.getByRole('button',{name:'Send instruction'}));
    await waitFor(()=>expect(intervene).toHaveBeenCalledWith('run-1','Still useful'));
  });

  it('keeps the instruction draft when the run can no longer accept it',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));const intervene=vi.fn(),instructionGateway={...gateway,intervene};
    render(<Composer gateway={instructionGateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} interventionTarget={{runId:'run-1',agent:'coder',mode:'unavailable'}}/>);
    const editor=screen.getByRole('textbox',{name:'Instruction for coder'});fireEvent.change(editor,{target:{value:'Still useful'}});fireEvent.click(screen.getByRole('button',{name:'Send instruction'}));
    expect(intervene).not.toHaveBeenCalled();expect(await screen.findByText(/can no longer accept instructions/)).toBeTruthy();expect((editor as HTMLTextAreaElement).value).toBe('Still useful');
  });
  it('shows the model in mention suggestions',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'@'}});
    expect(screen.getByRole('listbox',{name:'Select an agent to mention'})).toBeTruthy();
    expect(screen.getByText(/Claude Sonnet/)).toBeTruthy();
    expect(screen.queryByText(/Implementation/)).toBeNull();
  });

  it('shows the current workflow mode and persists either selection',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    const send=vi.fn<RoomGateway['send']>().mockResolvedValue(sentMessage),updateWorkflowMode=vi.fn(async()=>undefined),localGateway={...gateway,send};
    const props={gateway:localGateway,active:0,personas:[persona],harnessCatalog:catalog,catalogReady:true,onSent:vi.fn(async()=>undefined),openWorkspace:vi.fn(),roomId:'room',attachments:[],attachmentsBusy:false,openAttachmentPicker:vi.fn(),uploadFiles:vi.fn(),removeAttachment:vi.fn(),retryAttachment:vi.fn(),clearAttachments:vi.fn(),updateWorkflowMode};
    const view=render(<Composer {...props} workflowMode="work"/>);
    const workButton=screen.getByRole('button',{name:'Work mode. Switch to Plan'});
    expect(workButton.textContent).toContain('Work');
    expect(workButton.querySelector('.lucide-hammer')).toBeTruthy();
    expect(workButton.hasAttribute('aria-pressed')).toBe(false);
    fireEvent.click(workButton);
    await waitFor(()=>expect(updateWorkflowMode).toHaveBeenCalledWith('plan'));
    view.rerender(<Composer {...props} workflowMode="plan"/>);
    const planButton=screen.getByRole('button',{name:'Plan mode. Switch to Work'});
    expect(planButton.textContent).toContain('Plan');
    expect(planButton.querySelector('.lucide-shield')).toBeTruthy();
    expect(planButton.getAttribute('title')).toBe('Plan mode: project changes are blocked; MCP actions require confirmation. Switch to Work');
    fireEvent.click(planButton);
    await waitFor(()=>expect(updateWorkflowMode).toHaveBeenCalledWith('work'));
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
    expect(screen.getByRole('button',{name:'Plan mode. Switch to Work'}).textContent).toContain('Plan');
    expect(screen.queryByRole('button',{name:'Work mode. Switch to Plan'})).toBeNull();
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
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.change(editor,{target:{value:'@coder implement'}});
    expect(screen.getByRole('button',{name:'Send to 1 agent'})).toBeTruthy();
  });

  it('keeps the unavailable catalog empty state compact until typing starts',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady={false} onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()}/>);
    const editor=screen.getByRole('textbox',{name:'Message'});
    expect(editor.getAttribute('placeholder')).toBe('Agent catalog unavailable');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button',{name:'Post to room'}).hasAttribute('disabled')).toBe(true);
    fireEvent.change(editor,{target:{value:'Draft message'}});
    expect(editor.getAttribute('placeholder')).toBe('Message @handle or @all…');
    expect(screen.queryByRole('status')).toBeNull();
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

  it('moves conversation routing into the add menu on mobile',async()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
    const updateConversationRouting=vi.fn(async()=>undefined);
    render(<Composer gateway={gateway} active={0} personas={[persona]} harnessCatalog={catalog} catalogReady onSent={vi.fn(async()=>undefined)} openWorkspace={vi.fn()} roomId="room" attachments={[]} attachmentsBusy={false} openAttachmentPicker={vi.fn()} uploadFiles={vi.fn()} removeAttachment={vi.fn()} retryAttachment={vi.fn()} clearAttachments={vi.fn()} conversationRouting conversationRoutingMode="auto" updateConversationRouting={updateConversationRouting}/>);
    expect(screen.queryByRole('button',{name:/^Auto$/i})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Add to message'}));
    const auto=screen.getByRole('menuitemradio',{name:/Auto/}),roomContext=screen.getByRole('menuitemradio',{name:/Room context/});
    expect(auto.getAttribute('aria-checked')).toBe('true');
    auto.focus();fireEvent.keyDown(auto,{key:'ArrowDown'});expect(document.activeElement).toBe(roomContext);
    fireEvent.click(roomContext);
    await waitFor(()=>expect(updateConversationRouting).toHaveBeenCalledWith('room_context'));
    expect(screen.queryByRole('menu',{name:'Add to message'})).toBeNull();
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
