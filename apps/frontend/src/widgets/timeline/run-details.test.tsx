// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Persona } from '../../entities/persona';
import { initialState } from '../../entities/room';
import type { Run } from '../../entities/run';
import type { RoomGateway } from '../../features/room-session';
import { Timeline } from './Timeline';
import type { WorkspaceAttachment } from '@agenvyl/contracts';
import styles from './Timeline.module.css';

const persona: Persona = { id: 'persona-1', handle: 'coder', name: 'Coder', color: '#64748b', requested_model: 'sol', effective_model: null, harness_instance_id: 'local-hermes', harness_type: 'hermes', model_id: 'sol', permission_profile_id:null,agent_variant_id:null, default_reasoning_effort:null, group_id: null, archived_at: null };
const author={profileId:'local-user',displayName:'User',handle:'user'};
const run: Run = { id: 'run-1', messageId: 'message-1', agent: 'coder', harnessInstanceId: 'local-hermes', harnessType: 'hermes', modelId: 'sol', executionProfile:{workflowMode:'work',requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:null,agentVariantId:null}, status: 'completed', text: 'Готово', tools: [],interventions:[], usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } };
const workspaceResult={base_head:'base',result_head:'result',capture_status:'complete' as const,errors:[],updated_at:'2026-07-23T07:32:00.000Z'};
const gateway: RoomGateway = { mode: 'fake', subscribe: vi.fn(() => vi.fn()), send: vi.fn(), resolve: vi.fn(), intervene:vi.fn(), cancel: vi.fn(), retry: vi.fn(), select: vi.fn(), dispose: vi.fn() };
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('Timeline run details', () => {
  it('keeps the agent avatar outside the bordered response surface',()=>{
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder work',createdAt:'2026-07-20T12:00:00.000Z',targets:['coder' as const],runIds:['run-1'],author,addressedToAll:false}],runs:{'run-1':run},runOrder:['run-1']};
    const {container}=render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    const card=container.querySelector(`.${styles['run-card']}`)!;
    const avatar=card.querySelector(`.${styles['run-avatar']}`)!;
    const surface=card.querySelector(`.${styles['run-surface']}`)!;
    expect(avatar.parentElement).toBe(card);
    expect(surface.parentElement).toBe(card);
    expect(surface.contains(avatar)).toBe(false);
  });

  it('offers Add instruction only for an explicitly supported streaming run',()=>{
    const redirect=vi.fn(),streamingRun:Run={...run,status:'streaming',harnessInstanceId:'local-codex',harnessType:'codex'},state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder work',createdAt:'2026-07-20T12:00:00.000Z',targets:['coder' as const],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':streamingRun},runOrder:['run-1']},catalog={connectorEpoch:'epoch',cache:{state:'fresh' as const,refreshedAt:'2026-07-20T00:00:00.000Z',expiresAt:'2026-07-20T01:00:00.000Z'},instances:[{id:'local-codex',type:'codex',status:'healthy' as const,capabilities:[],interventionMode:'interrupt_then_continue' as const,models:[],controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]},catalogCache:{state:'fresh' as const,refreshedAt:'2026-07-20T00:00:00.000Z'}}]};
    const view=render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} harnessCatalog={catalog} addInstructionToRun={redirect}/>);
    fireEvent.click(screen.getByRole('button',{name:'Add instruction to Coder'}));expect(redirect).toHaveBeenCalledWith('run-1');
    view.rerender(<Timeline state={{...state,runs:{'run-1':{...streamingRun,text:'',interventions:[{id:'instruction',text:'Change direction',status:'pending',precedingText:'Готово',author,createdAt:'2026-07-20T12:01:00.000Z'}]}}}} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} harnessCatalog={catalog} addInstructionToRun={redirect}/>);
    expect(screen.queryByRole('button',{name:'Add instruction to Coder'})).toBeNull();expect(screen.getByText('Sending…')).toBeTruthy();
  });
  it('renders answer segments around an instruction and keeps only its state live',()=>{
    const instructionRun:Run={...run,reasoning:'Plan carefully',text:'After instruction',interventions:[{id:'instruction',text:'Focus on the API',status:'applied',precedingText:'Before instruction',author,createdAt:'2026-07-20T12:01:00.000Z'}]};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder work',createdAt:'2026-07-20T12:00:00.000Z',targets:['coder' as const],runIds:['run-1'],author,addressedToAll:false}],runs:{'run-1':instructionRun},runOrder:['run-1']};
    render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    const reasoning=screen.getByText('Reasoning'),before=screen.getByText('Before instruction'),instruction=screen.getByLabelText('Instruction from User'),after=screen.getByText('After instruction');
    expect(reasoning.compareDocumentPosition(before)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(before.compareDocumentPosition(instruction)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(instruction.compareDocumentPosition(after)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(instruction).getByRole('status').textContent).toBe('Applied');
    expect(instruction.getAttribute('role')).toBeNull();
    expect(screen.queryByText(/Earlier output before/)).toBeNull();
    expect(screen.queryByText('Redirect')).toBeNull();
  });

  it('keeps failed and legacy instructions in the visible answer history',()=>{
    const instructionRun:Run={...run,status:'streaming',text:'Current answer',interventions:[{id:'legacy',text:'Legacy guidance',status:'applied',supersededText:'Legacy answer'},{id:'failed',text:'Try another path',status:'failed',error:'Instruction rejected'}]};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder work',createdAt:'2026-07-20T12:00:00.000Z',targets:['coder' as const],runIds:['run-1'],author,addressedToAll:false}],runs:{'run-1':instructionRun},runOrder:['run-1']};
    render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    const legacy=screen.getByText('Legacy answer'),current=screen.getByText('Current answer'),failed=screen.getByText('Try another path');
    expect(legacy.compareDocumentPosition(current)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(current.compareDocumentPosition(failed)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Instruction rejected')).toBeTruthy();
    const cursor=document.querySelector(`.${styles.cursor}`)!;
    expect(failed.compareDocumentPosition(cursor)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not auto-collapse a completed answer with instructions',()=>{
    const instructionRun:Run={...run,text:`After ${'detail '.repeat(80)}`,interventions:[{id:'instruction',text:'Continue',status:'applied',precedingText:`Before ${'detail '.repeat(80)}`,author}]};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder work',createdAt:'2026-07-20T12:00:00.000Z',targets:['coder' as const],runIds:['run-1'],author,addressedToAll:false}],runs:{'run-1':instructionRun},runOrder:['run-1']};
    const {container}=render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    const history=container.querySelector(`.${styles['answer-history']}`)!;
    expect(history.classList.contains(styles['answer-collapsed'])).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Collapse response'}));
    expect(history.classList.contains(styles['answer-collapsed'])).toBe(true);
  });

  it('offers run details when the run has usage but no tool calls', () => {
    const historicalRun={...run,harnessInstanceId:'local-opencode',harnessType:'opencode'};
    const state = { ...initialState, hydrated: true, messages: [{ id: 'message-1', text: '@coder ответь', createdAt: '2026-07-20T12:00:00.000Z', targets: ['coder' as const], runIds: ['run-1'], author: { profileId: 'local-user', displayName: 'User', handle: 'user' }, addressedToAll: false }], runs: { 'run-1': historicalRun }, runOrder: ['run-1'] };
    const {container}=render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} />);
    const html=container.innerHTML;
    expect(html).toContain('Run details');
    expect(html).toContain('aria-label="OpenCode"');
    expect(html).not.toContain('aria-label="Hermes"');
    expect(html).not.toContain('Actions');
    expect(screen.getByRole('button',{name:'Run details: Coder'}).closest('header')).toBeTruthy();
    expect(container.querySelector(`.${styles['run-meta-row']}`)).toBeNull();
  });

  it('keeps tool activity behind the run activity disclosure', () => {
    const toolRun:Run={...run,tools:[{id:'tool-1',name:'read_file',detail:'README.md',status:'completed'}]};
    const state = { ...initialState, hydrated: true, messages: [{ id: 'message-1', text: '@coder проверь', createdAt: '2026-07-20T12:00:00.000Z', targets: ['coder' as const], runIds: ['run-1'], author: { profileId: 'local-user', displayName: 'User', handle: 'user' }, addressedToAll: false }], runs: { 'run-1': toolRun }, runOrder: ['run-1'] };
    render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} />);
    const disclosure=screen.getByRole('button',{name:'Run activity: 1 action'});
    const activity=disclosure.closest('details') as HTMLDetailsElement;
    expect(activity.open).toBe(false);
    fireEvent.click(disclosure);
    expect(screen.getByRole('region',{name:'Tool calls'})).toBeTruthy();
    expect(screen.getByRole('heading',{name:'Tool calls 1'})).toBeTruthy();
    expect(screen.getByText('read_file')).toBeTruthy();
    expect(screen.getByRole('img',{name:'Tool status: Completed'})).toBeTruthy();
    expect(screen.queryByText('completed')).toBeNull();
    expect(activity.open).toBe(true);
    fireEvent.click(disclosure);
    expect(activity.open).toBe(false);
  });

  it('places compact reasoning metadata beside the model without a profile badge', () => {
    const reasoningRun:Run={...run,executionProfile:{...run.executionProfile,requestedReasoningEffort:'max',reasoningEffort:'max',reasoningEffortSource:'room_override'}};
    const state = { ...initialState, hydrated: true, messages: [{ id: 'message-1', text: '@coder ответь', createdAt: '2026-07-20T12:00:00.000Z', targets: ['coder' as const], runIds: ['run-1'], author: { profileId: 'local-user', displayName: 'User', handle: 'user' }, addressedToAll: false }], runs: { 'run-1': reasoningRun }, runOrder: ['run-1'] };
    render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} />);
    expect(screen.getByLabelText('Reasoning effort: max')).toBeTruthy();
    expect(screen.queryByText('Work · max')).toBeNull();
  });

  it('places reasoning above the answer without creating run activity by itself',()=>{
    const reasoningRun:Run={...run,reasoning:'Inspect the implementation first'};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder inspect',createdAt:'2026-07-20T12:00:00.000Z',targets:['coder' as const],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':reasoningRun},runOrder:['run-1']};
    const {container}=render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    const reasoning=screen.getByText('Reasoning').closest('details') as HTMLDetailsElement;
    const answer=container.querySelector(`.${styles.answer}`) as HTMLDivElement;
    expect(reasoning.compareDocumentPosition(answer)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(container).queryByRole('button',{name:/Run activity/})).toBeNull();
  });

  it('keeps a no-op workspace result visually neutral',()=>{
    const noopRun:Run={...run,workspaceResult:{...workspaceResult,result_head:'base'}};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder answer',createdAt:'2026-07-20T12:00:00.000Z',targets:['coder' as const],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':noopRun},runOrder:['run-1']};
    render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    expect(screen.queryByText('Changes applied to room workspace')).toBeNull();
    expect(screen.queryByText('Snapshot saved')).toBeNull();
  });

  it('does not describe an empty failed run as analyzing',()=>{
    const failedRun:Run={...run,status:'failed',text:'',errorCode:'execution_failed',error:'Agent execution terminated due to error.'};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder inspect',createdAt:'2026-07-20T12:00:00.000Z',targets:['coder' as const],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':failedRun},runOrder:['run-1']};
    const {container}=render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    expect(screen.queryByText('Analyzing…')).toBeNull();
    expect(screen.getByText('Agent execution terminated due to error.')).toBeTruthy();
    expect(container.querySelector(`.${styles.answer}`)).toBeNull();
  });

  it('does not offer workspace actions for a cancelled run without project changes',()=>{
    const cancelledRun:Run={...run,status:'cancelled',artifactSummary:{total_count:0,project_count:0,hidden_count:0},staticPreviewStatus:'build_missing',workspaceResult};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder inspect',createdAt:'2026-07-20T12:00:00.000Z',targets:['coder' as const],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':cancelledRun},runOrder:['run-1']};
    render(<Timeline roomId="room-1" state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    expect(screen.queryByRole('button',{name:'Apply changes'})).toBeNull();
    expect(screen.queryByText('Preview unavailable · Build output not found')).toBeNull();
    expect(screen.queryByRole('button',{name:/Run activity/})).toBeNull();
  });

  it('opens changed files in workspace and message attachments in the immutable viewer', () => {
    const file:WorkspaceAttachment={version_id:'version-synopsis',entry_id:'entry-synopsis',path:'prvaya-popytka-synopsis.md',name:'prvaya-popytka-synopsis.md',size:8287,mime_type:'text/markdown',url:'/version-synopsis',preview_url:'/version-synopsis/preview'};
    const artifactRun:Run={...run,artifacts:[{...file,change:'created',attribution:'exact'}],workspaceResult};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder продолжай',createdAt:'2026-07-23T07:31:58.341Z',targets:['coder' as const],runIds:['run-1'],attachments:[file],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':artifactRun},runOrder:['run-1']};
    const openArtifact=vi.fn();
    const openWorkspace=vi.fn();
    const {container}=render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} openArtifact={openArtifact} openWorkspace={openWorkspace}/>);

    fireEvent.click(container.querySelector(`.${styles.attachmentPrimary}`) as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button',{name:'prvaya-popytka-synopsis.md'}));
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(openArtifact.mock.calls[0]?.[0]).toMatchObject({entry_id:'entry-synopsis',version_id:'version-synopsis'});
    expect(openWorkspace).toHaveBeenCalledWith({entryId:'entry-synopsis',versionId:'version-synopsis',path:'prvaya-popytka-synopsis.md'});
    expect(screen.getByLabelText('Files changed by agent')).toBeTruthy();
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Run activity: workspace'}));
    expect(screen.getByText('Workspace updated')).toBeTruthy();
    expect(screen.getByText('· 1 file')).toBeTruthy();
    expect(screen.queryByText('Published')).toBeNull();
  });

  it('keeps failed-run artifacts compact and exposes the immutable Preview action',()=>{
    const files=Array.from({length:6},(_,index)=>({
      version_id:`version-${index+1}`,
      path:`src/file-${index+1}.ts`,
      name:`file-${index+1}.ts`,
      size:10,
      mime_type:'text/typescript',
      url:`/version-${index+1}`,
      preview_url:`/version-${index+1}/preview`,
      change:'created' as const,
      attribution:'exact' as const,
    }));
    const preview:WorkspaceAttachment={version_id:'preview-version',path:'dist/index.html',name:'index.html',size:100,mime_type:'text/html',url:'/preview-version',preview_url:'/api/v1/rooms/room-1/runs/run-1/preview/'};
    const failedRun:Run={...run,status:'failed',artifacts:files,artifactSummary:{total_count:8,project_count:6,hidden_count:2},staticPreview:preview,staticPreviewStatus:'ready',workspaceResult};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder build',createdAt:'2026-07-23T07:31:58.341Z',targets:['coder' as const],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':failedRun},runOrder:['run-1']};
    const openArtifact=vi.fn();
    render(<Timeline roomId="room-1" state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} openArtifact={openArtifact}/>);

    expect(screen.getByText('6 project files · 2 non-project files hidden')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'file-5.ts'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Show 2 more'}));
    expect(screen.getByRole('button',{name:'file-5.ts'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'Show less'})).toBeTruthy();

    const openBuild=screen.getByRole('button',{name:'Open the app build captured for this response'});
    expect(openBuild.textContent).toContain('Open this build');
    fireEvent.click(openBuild);
    expect(openArtifact).toHaveBeenCalledWith(preview,[preview],expect.any(HTMLButtonElement),{section:'app',buildRunId:'run-1'});
    expect(screen.queryByRole('button',{name:'Apply changes'})).toBeNull();
  });

  it('explains when a detected web project has no static build',()=>{
    const webRun:Run={...run,artifactSummary:{total_count:1,project_count:1,hidden_count:0},staticPreviewStatus:'build_missing'};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder build',createdAt:'2026-07-23T07:31:58.341Z',targets:['coder' as const],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':webRun},runOrder:['run-1']};
    render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    expect(screen.getByText('Preview unavailable · Build output not found')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Preview'})).toBeNull();
  });

  it('hides resolved requests but keeps unresolved requests visible',()=>{
    const resolvedRun:Run={...run,requests:[{id:'request-resolved',kind:'approval',prompt:'Allow completed action?',resolved:'answered'}]};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder continue',createdAt:'2026-07-23T07:31:58.341Z',targets:['coder' as const],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':resolvedRun},runOrder:['run-1']};
    const {rerender}=render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    expect(screen.queryByText('Allow completed action?')).toBeNull();
    expect(screen.queryByText(/approval/)).toBeNull();

    const unresolvedRun:Run={...resolvedRun,requests:[{id:'request-pending',kind:'approval',prompt:'Allow pending action?'}]};
    rerender(<Timeline state={{...state,runs:{'run-1':unresolvedRun}}} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    expect(screen.getByText('Allow pending action?')).toBeTruthy();
  });

  it('shows one focused response when a round contains multiple long answers',()=>{
    const secondPersona:Persona={...persona,id:'persona-2',handle:'reviewer',name:'Reviewer',color:'#2563eb'};
    const firstRun:Run={...run,text:`Alpha answer ${'detail '.repeat(160)}`,responseSlotId:'slot-alpha'};
    const secondRun:Run={...run,id:'run-2',agent:'reviewer',text:`Beta answer ${'detail '.repeat(160)}`,responseSlotId:'slot-beta'};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@all compare',createdAt:'2026-07-23T07:31:58.341Z',targets:['coder','reviewer'],runIds:['run-1','run-2'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:true}],runs:{'run-1':firstRun,'run-2':secondRun},runOrder:['run-1','run-2']};
    render(<Timeline state={state} personas={[persona,secondPersona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    expect(screen.getByText(/Alpha answer/)).toBeTruthy();
    expect(screen.queryByText(/Beta answer/)).toBeNull();
    fireEvent.click(within(screen.getByRole('navigation',{name:'Agent responses in this round'})).getByRole('button',{name:/Reviewer/}));
    expect(screen.queryByText(/Alpha answer/)).toBeNull();
    expect(screen.getByText(/Beta answer/)).toBeTruthy();
  });

});
