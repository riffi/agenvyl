import { describe, expect, it } from 'vitest';
import { initialSupervisorState, terminationPolicy, transitionSupervisor } from './supervisor.js';

describe('supervisor contract', () => {
  it('starts in dependency order and stops in reverse order', () => {
    let state = transitionSupervisor(initialSupervisorState(), { type: 'start_requested' });
    state = transitionSupervisor(state, { type: 'component_started', component: 'postgresql' });
    state = transitionSupervisor(state, { type: 'component_started', component: 'connector' });
    state = transitionSupervisor(state, { type: 'component_started', component: 'core' });
    expect(state.phase).toBe('running');

    state = transitionSupervisor(state, { type: 'stop_requested' });
    state = transitionSupervisor(state, { type: 'component_stopped', component: 'core' });
    state = transitionSupervisor(state, { type: 'component_stopped', component: 'connector' });
    state = transitionSupervisor(state, { type: 'component_stopped', component: 'postgresql' });
    expect(state).toEqual(initialSupervisorState());
  });

  it('rejects components reported out of order', () => {
    const state = transitionSupervisor(initialSupervisorState(), { type: 'start_requested' });
    expect(() => transitionSupervisor(state, { type: 'component_started', component: 'core' })).toThrow('Invalid supervisor transition');
  });

  it('records a component failure and permits shutdown', () => {
    let state = transitionSupervisor(initialSupervisorState(), { type: 'start_requested' });
    state = transitionSupervisor(state, { type: 'component_failed', component: 'postgresql', message: 'not ready' });
    expect(state).toMatchObject({ phase: 'failed', failure: { component: 'postgresql', message: 'not ready' } });
    expect(transitionSupervisor(state, { type: 'stop_requested' })).toEqual(initialSupervisorState());
  });

  it('stops only components that reached running after a partial startup', () => {
    let state = transitionSupervisor(initialSupervisorState(), { type: 'start_requested' });
    state = transitionSupervisor(state, { type: 'component_started', component: 'postgresql' });
    state = transitionSupervisor(state, { type: 'component_failed', component: 'connector', message: 'not ready' });
    state = transitionSupervisor(state, { type: 'stop_requested' });
    expect(state.phase).toBe('stopping');
    expect(transitionSupervisor(state, { type: 'component_stopped', component: 'postgresql' })).toEqual(initialSupervisorState());
  });

  it('defines bounded process-tree termination on every supported platform', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      expect(terminationPolicy(platform, 5_000)).toEqual({
        gracefulSignal: 'SIGTERM',
        forceSignal: 'SIGKILL',
        gracePeriodMs: 5_000,
        terminateProcessTree: true,
      });
    }
    expect(() => terminationPolicy('freebsd')).toThrow('Unsupported Agenvyl platform');
  });
});
