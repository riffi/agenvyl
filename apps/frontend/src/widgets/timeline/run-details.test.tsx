// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Persona } from '../../entities/persona';
import { initialState, roomsApi } from '../../entities/room';
import type { Run } from '../../entities/run';
import type { RoomGateway } from '../../features/room-session';
import { Timeline } from './Timeline';
import type { WorkspaceAttachment } from '@agenvyl/contracts';

const persona: Persona = { id: 'persona-1', handle: 'coder', name: 'Coder', role: 'Code', color: '#64748b', requested_model: 'sol', effective_model: null, harness_instance_id: 'local-hermes', harness_type: 'hermes', model_id: 'sol', permission_profile_id:null,agent_variant_id:null, default_reasoning_effort:null, group_id: null, archived_at: null };
const run: Run = { id: 'run-1', messageId: 'message-1', agent: 'coder', harnessInstanceId: 'local-hermes', harnessType: 'hermes', modelId: 'sol', executionProfile:{workflowMode:'work',requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:null,agentVariantId:null,implementationPlanVersionId:null}, status: 'completed', text: 'Готово', tools: [], usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } };
const gateway: RoomGateway = { mode: 'fake', subscribe: vi.fn(() => vi.fn()), send: vi.fn(), resolve: vi.fn(), cancel: vi.fn(), retry: vi.fn(), select: vi.fn(), dispose: vi.fn() };
afterEach(()=>vi.restoreAllMocks());

describe('Timeline run details', () => {
  it('offers run details when the run has usage but no tool calls', () => {
    const historicalRun={...run,harnessInstanceId:'local-opencode',harnessType:'opencode'};
    const state = { ...initialState, hydrated: true, messages: [{ id: 'message-1', text: '@coder ответь', createdAt: '2026-07-20T12:00:00.000Z', targets: ['coder' as const], runIds: ['run-1'], author: { profileId: 'local-user', displayName: 'User', handle: 'user' }, addressedToAll: false }], runs: { 'run-1': historicalRun }, runOrder: ['run-1'] };
    const html = renderToStaticMarkup(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} />);
    expect(html).toContain('Run details');
    expect(html).toContain('aria-label="OpenCode"');
    expect(html).not.toContain('aria-label="Hermes"');
    expect(html).not.toContain('Actions');
  });

  it('keeps tool activity inline behind the footer disclosure', () => {
    const toolRun:Run={...run,tools:[{id:'tool-1',name:'read_file',detail:'README.md',status:'completed'}]};
    const state = { ...initialState, hydrated: true, messages: [{ id: 'message-1', text: '@coder проверь', createdAt: '2026-07-20T12:00:00.000Z', targets: ['coder' as const], runIds: ['run-1'], author: { profileId: 'local-user', displayName: 'User', handle: 'user' }, addressedToAll: false }], runs: { 'run-1': toolRun }, runOrder: ['run-1'] };
    render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} />);
    const disclosure=screen.getByRole('button',{name:/Actions/});
    expect(screen.queryByText('read_file')).toBeNull();
    fireEvent.click(disclosure);
    expect(screen.getByText('read_file')).toBeTruthy();
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(disclosure);
    expect(screen.queryByText('read_file')).toBeNull();
  });

  it('places compact reasoning metadata beside the model without a profile badge', () => {
    const reasoningRun:Run={...run,executionProfile:{...run.executionProfile,requestedReasoningEffort:'max',reasoningEffort:'max',reasoningEffortSource:'room_override'}};
    const state = { ...initialState, hydrated: true, messages: [{ id: 'message-1', text: '@coder ответь', createdAt: '2026-07-20T12:00:00.000Z', targets: ['coder' as const], runIds: ['run-1'], author: { profileId: 'local-user', displayName: 'User', handle: 'user' }, addressedToAll: false }], runs: { 'run-1': reasoningRun }, runOrder: ['run-1'] };
    render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} />);
    expect(screen.getByLabelText('Reasoning effort: max')).toBeTruthy();
    expect(screen.queryByText('Work · max')).toBeNull();
  });

  it('routes agent artifacts and message attachments through the immutable artifact viewer', () => {
    const file:WorkspaceAttachment={version_id:'version-synopsis',entry_id:'entry-synopsis',path:'prvaya-popytka-synopsis.md',name:'prvaya-popytka-synopsis.md',size:8287,mime_type:'text/markdown',url:'/version-synopsis',preview_url:'/version-synopsis/preview'};
    const artifactRun:Run={...run,artifacts:[{...file,change:'created',attribution:'exact'}],workspaceResult:{base_snapshot_id:'base',result_snapshot_id:'result',published_snapshot_id:'published',capture_status:'complete',publish_status:'published',conflict_count:0,errors:[]}};
    const state={...initialState,hydrated:true,messages:[{id:'message-1',text:'@coder продолжай',createdAt:'2026-07-23T07:31:58.341Z',targets:['coder' as const],runIds:['run-1'],attachments:[file],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false}],runs:{'run-1':artifactRun},runOrder:['run-1']};
    const openArtifact=vi.fn();
    const {container}=render(<Timeline state={state} personas={[persona]} select={vi.fn()} gateway={gateway} loadOlder={vi.fn()} loadingOlder={false} initialLoading={false} onMentionPersona={vi.fn()} openArtifact={openArtifact}/>);

    const buttons=screen.getAllByRole('button',{name:/^prvaya-popytka-synopsis\.md/});
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(openArtifact).toHaveBeenCalledTimes(2);
    expect(openArtifact.mock.calls[0]?.[0]).toMatchObject({entry_id:'entry-synopsis',version_id:'version-synopsis'});
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
    expect(screen.getByText('Changes applied to room workspace')).toBeTruthy();
    expect(screen.getByText('· 1 file')).toBeTruthy();
    expect(screen.queryByText('Published')).toBeNull();
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
