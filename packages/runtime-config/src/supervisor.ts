export const SUPERVISOR_START_ORDER = ['postgresql', 'connector', 'core'] as const;
export const SUPERVISOR_STOP_ORDER = [...SUPERVISOR_START_ORDER].reverse() as SupervisorComponent[];

export type SupervisorComponent = typeof SUPERVISOR_START_ORDER[number];
export type SupervisorPhase = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
export type ComponentPhase = 'stopped' | 'running';

export type SupervisorState = {
  phase: SupervisorPhase;
  components: Record<SupervisorComponent, ComponentPhase>;
  failure?: { component: SupervisorComponent; message: string };
};

export type SupervisorEvent =
  | { type: 'start_requested' }
  | { type: 'component_started'; component: SupervisorComponent }
  | { type: 'stop_requested' }
  | { type: 'component_stopped'; component: SupervisorComponent }
  | { type: 'component_failed'; component: SupervisorComponent; message: string };

export type TerminationPolicy = {
  gracefulSignal: 'SIGTERM';
  forceSignal: 'SIGKILL';
  gracePeriodMs: number;
  terminateProcessTree: boolean;
};

export function initialSupervisorState(): SupervisorState {
  return { phase: 'stopped', components: { postgresql: 'stopped', connector: 'stopped', core: 'stopped' } };
}

export function transitionSupervisor(state: SupervisorState, event: SupervisorEvent): SupervisorState {
  if (event.type === 'component_failed') {
    return { ...state, phase: 'failed', failure: { component: event.component, message: event.message } };
  }
  if (event.type === 'start_requested') {
    if (state.phase !== 'stopped' && state.phase !== 'failed') return invalid(state, event.type);
    return { phase: 'starting', components: { ...state.components } };
  }
  if (event.type === 'stop_requested') {
    if (!['starting', 'running', 'failed'].includes(state.phase)) return invalid(state, event.type);
    const components = { ...state.components };
    return { phase: Object.values(components).some(value => value === 'running') ? 'stopping' : 'stopped', components };
  }
  if (event.type === 'component_started') {
    if (state.phase !== 'starting' || event.component !== nextComponent(state, SUPERVISOR_START_ORDER, 'stopped')) return invalid(state, event.type);
    const components = { ...state.components, [event.component]: 'running' as const };
    return { phase: Object.values(components).every(value => value === 'running') ? 'running' : 'starting', components };
  }
  if (state.phase !== 'stopping' || event.component !== nextComponent(state, SUPERVISOR_STOP_ORDER, 'running')) return invalid(state, event.type);
  const components = { ...state.components, [event.component]: 'stopped' as const };
  return { phase: Object.values(components).every(value => value === 'stopped') ? 'stopped' : 'stopping', components };
}

export function terminationPolicy(platform: NodeJS.Platform, gracePeriodMs = 10_000): TerminationPolicy {
  if (!Number.isSafeInteger(gracePeriodMs) || gracePeriodMs < 1) throw new Error('gracePeriodMs must be a positive integer');
  if (!['linux', 'darwin', 'win32'].includes(platform)) throw new Error(`Unsupported Agenvyl platform: ${platform}`);
  return { gracefulSignal: 'SIGTERM', forceSignal: 'SIGKILL', gracePeriodMs, terminateProcessTree: true };
}

function nextComponent(
  state: SupervisorState,
  order: readonly SupervisorComponent[],
  phase: ComponentPhase,
) {
  return order.find(component => state.components[component] === phase);
}

function invalid(state: SupervisorState, event: SupervisorEvent['type']): never {
  throw new Error(`Invalid supervisor transition: ${state.phase} -> ${event}`);
}
