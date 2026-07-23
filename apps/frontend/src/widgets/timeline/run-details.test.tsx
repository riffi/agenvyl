// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Persona } from '../../entities/persona';
import { initialState } from '../../entities/room';
import type { Run } from '../../entities/run';
import type { RoomGateway } from '../../features/room-session';
import { Timeline } from './Timeline';

const persona: Persona = { id: 'persona-1', handle: 'coder', name: 'Coder', role: 'Code', color: '#64748b', requested_model: 'sol', effective_model: null, harness_instance_id: 'local-hermes', harness_type: 'hermes', model_id: 'sol', permission_profile_id:null,agent_variant_id:null, default_reasoning_effort:null, group_id: null, archived_at: null };
const run: Run = { id: 'run-1', messageId: 'message-1', agent: 'coder', harnessInstanceId: 'local-hermes', harnessType: 'hermes', modelId: 'sol', executionProfile:{workflowMode:'work',requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:null,agentVariantId:null,implementationPlanVersionId:null}, status: 'completed', text: 'Готово', tools: [], usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } };
const gateway: RoomGateway = { mode: 'fake', subscribe: vi.fn(() => vi.fn()), send: vi.fn(), resolve: vi.fn(), cancel: vi.fn(), retry: vi.fn(), select: vi.fn(), dispose: vi.fn() };

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
});
