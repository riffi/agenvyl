// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Persona } from '../../entities/persona';
import { initialState, roomsApi } from '../../entities/room';
import type { Run } from '../../entities/run';
import type { RoomGateway } from '../../features/room-session';
import { Timeline } from './Timeline';
import type { WorkspaceAttachment } from '@agenvyl/contracts';
import styles from './Timeline.module.css';

const persona: Persona = { id: 'persona-1', handle: 'coder', name: 'Coder', color: '#64748b', requested_model: 'sol', effective_model: null, harness_instance_id: 'local-hermes', harness_type: 'hermes', model_id: 'sol', permission_profile_id:null,agent_variant_id:null, default_reasoning_effort:null, group_id: null, archived_at: null };
const run: Run = { id: 'run-1', messageId: 'message-1', agent: 'coder', harnessInstanceId: 'local-hermes', harnessType: 'hermes', modelId: 'sol', executionProfile:{workflowMode:'work',requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:null,agentVariantId:null}, status: 'completed', text: 'Готово', tools: [],interventions:[], usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } };
const gateway: RoomGateway = { mode: 'fake', subscribe: vi.fn(() => vi.fn()), send: vi.fn(), resolve: vi.fn(), intervene:vi.fn(), cancel: vi.fn(), retry: vi.fn(), select: vi.fn(), dispose: vi.fn() };
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('Timeline run details', () => {
  it('offers Redirect only for an explicitly supported streaming run',()=>{
    const redirect=vi.fn(),streamingRun:Run={...run,status:'streaming',harnessInstanceId:'local-codex',harnessType:'codex'},state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder work',createdAt:'2026-07-20T12:00:00.000Z',targets:['coder' as const],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':streamingRun},runOrder:['run-1']},catalog={connectorEpoch:'epoch',cache:{state:'fresh' as const,refreshedAt:'2026-07-20T00:00:00.000Z',expiresAt:'2026-07-20T01:00:00.000Z'},instances:[{id:'local-codex',type:'codex',status:'healthy' as const,capabilities:[],interventionMode:'interrupt_then_continue' as const,models:[],controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]},catalogCache:{state:'fresh' as const,refreshedAt:'2026-07-20T00:00:00.000Z'}}]};
    const view=render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} harnessCatalog={catalog} redirectRun={redirect}/>);
    fireEvent.click(screen.getByRole('button',{name:'Redirect Coder response'}));expect(redirect).toHaveBeenCalledWith('run-1');
    view.rerender(<Timeline state={{...state,runs:{'run-1':{...streamingRun,interventions:[{id:'redirect',text:'Change direction',status:'pending'}]}}}} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} harnessCatalog={catalog} redirectRun={redirect}/>);
    expect(screen.queryByRole('button',{name:'Redirect Coder response'})).toBeNull();expect(screen.getByText('Redirecting…')).toBeTruthy();
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
    const noopRun:Run={...run,workspaceResult:{base_snapshot_id:'base',result_snapshot_id:'base',capture_status:'complete',publish_status:'noop',conflict_count:0,errors:[]}};
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
    const cancelledRun:Run={...run,status:'cancelled',artifactSummary:{total_count:0,project_count:0,hidden_count:0},staticPreviewStatus:'build_missing',workspaceResult:{base_snapshot_id:'base',result_snapshot_id:'result',capture_status:'complete',publish_status:'not_published',conflict_count:0,errors:[]}};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder inspect',createdAt:'2026-07-20T12:00:00.000Z',targets:['coder' as const],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':cancelledRun},runOrder:['run-1']};
    render(<Timeline roomId="room-1" state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    expect(screen.queryByRole('button',{name:'Apply changes'})).toBeNull();
    expect(screen.queryByText('Preview unavailable · Build output not found')).toBeNull();
    expect(screen.queryByRole('button',{name:/Run activity/})).toBeNull();
  });

  it('opens changed files in workspace and message attachments in the immutable viewer', () => {
    const file:WorkspaceAttachment={version_id:'version-synopsis',entry_id:'entry-synopsis',path:'prvaya-popytka-synopsis.md',name:'prvaya-popytka-synopsis.md',size:8287,mime_type:'text/markdown',url:'/version-synopsis',preview_url:'/version-synopsis/preview'};
    const artifactRun:Run={...run,artifacts:[{...file,change:'created',attribution:'exact'}],workspaceResult:{base_snapshot_id:'base',result_snapshot_id:'result',published_snapshot_id:'published',capture_status:'complete',publish_status:'published',conflict_count:0,errors:[]}};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder продолжай',createdAt:'2026-07-23T07:31:58.341Z',targets:['coder' as const],runIds:['run-1'],attachments:[file],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':artifactRun},runOrder:['run-1']};
    const openArtifact=vi.fn();
    const openWorkspace=vi.fn();
    const {container}=render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} openArtifact={openArtifact} openWorkspace={openWorkspace}/>);

    fireEvent.click(container.querySelector(`.${styles.attachmentPrimary}`) as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button',{name:'prvaya-popytka-synopsis.md'}));
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(openArtifact.mock.calls[0]?.[0]).toMatchObject({entry_id:'entry-synopsis',version_id:'version-synopsis'});
    expect(openWorkspace).toHaveBeenCalledWith({entryId:'entry-synopsis',versionId:'version-synopsis',snapshotId:undefined,path:'prvaya-popytka-synopsis.md'});
    expect(screen.getByLabelText('Files changed by agent')).toBeTruthy();
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Run activity: workspace'}));
    expect(screen.getByText('Changes applied to room workspace')).toBeTruthy();
    expect(screen.getByText('· 1 file')).toBeTruthy();
    expect(screen.queryByText('Published')).toBeNull();
  });

  it('keeps failed-run artifacts compact and exposes Apply and immutable Preview actions',async()=>{
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
    const preview:WorkspaceAttachment={version_id:'preview-version',snapshot_id:'result',path:'dist/index.html',name:'index.html',size:100,mime_type:'text/html',url:'/preview-version',preview_url:'/api/v1/rooms/room-1/runs/run-1/preview/'};
    const failedRun:Run={...run,status:'failed',artifacts:files,artifactSummary:{total_count:8,project_count:6,hidden_count:2},staticPreview:preview,staticPreviewStatus:'ready',workspaceResult:{base_snapshot_id:'base',result_snapshot_id:'result',capture_status:'complete',publish_status:'not_published',conflict_count:0,errors:[]}};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder build',createdAt:'2026-07-23T07:31:58.341Z',targets:['coder' as const],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':failedRun},runOrder:['run-1']};
    const openArtifact=vi.fn(),confirm=vi.fn(()=>true);
    vi.stubGlobal('confirm',confirm);
    let finishApply!:(value:Awaited<ReturnType<typeof roomsApi.applyRunWorkspace>>)=>void;
    const apply=vi.spyOn(roomsApi,'applyRunWorkspace').mockImplementation(()=>new Promise(resolve=>{finishApply=resolve}));
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
    fireEvent.click(screen.getByRole('button',{name:'Apply changes'}));
    expect(confirm).toHaveBeenCalledWith('Apply 6 project files to the room workspace? 2 non-project files will remain only in the run snapshot.');
    expect((screen.getByRole('button',{name:'Applying…'}) as HTMLButtonElement).disabled).toBe(true);
    finishApply({base_snapshot_id:'base',result_snapshot_id:'result',published_snapshot_id:'published',capture_status:'complete',publish_status:'published',conflict_count:0,errors:[]});
    await waitFor(()=>expect(apply).toHaveBeenCalledWith('room-1','run-1'));
    await waitFor(()=>expect((screen.getByRole('button',{name:'Apply changes'}) as HTMLButtonElement).disabled).toBe(false));
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

  it('resolves every workspace conflict in one request and reloads stale conflicts',async()=>{
    const conflictRun:Run={...run,workspaceResult:{base_snapshot_id:'base',result_snapshot_id:'result',published_snapshot_id:'published',capture_status:'complete',publish_status:'partially_published',conflict_count:1,errors:[]}};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder edit',createdAt:'2026-07-23T07:31:58.341Z',targets:['coder' as const],runIds:['run-1'],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':conflictRun},runOrder:['run-1']};
    const conflict={path:'site/style.css',current:{kind:'file' as const,version_id:'current-v1'},candidate:{kind:'file' as const,version_id:'candidate-v1'}};
    const load=vi.spyOn(roomsApi,'workspaceConflicts')
      .mockResolvedValueOnce({run_id:'run-1',expected_current_snapshot_id:'current-1',conflicts:[conflict]})
      .mockResolvedValueOnce({run_id:'run-1',expected_current_snapshot_id:'current-2',conflicts:[{...conflict,current:{kind:'file',version_id:'current-v2'}}]});
    const stale=Object.assign(new Error('stale'),{code:'workspace_conflict_stale'});
    const resolve=vi.spyOn(roomsApi,'resolveWorkspaceConflicts').mockRejectedValueOnce(stale);
    render(<Timeline roomId="room-1" state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Review conflicts'}));
    const choice=await screen.findByLabelText('Resolution for site/style.css');
    fireEvent.change(choice,{target:{value:'candidate'}});
    fireEvent.click(screen.getByRole('button',{name:'Apply all resolutions'}));
    await waitFor(()=>expect(resolve).toHaveBeenCalledWith('room-1','run-1',{expected_current_snapshot_id:'current-1',resolutions:[{path:'site/style.css',choice:'candidate'}]}));
    await waitFor(()=>expect(load).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/The workspace changed\. Conflicts were recalculated/)).toBeTruthy();
    expect((screen.getByLabelText('Resolution for site/style.css') as HTMLSelectElement).value).toBe('current');
  });
});
