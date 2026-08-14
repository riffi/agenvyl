import type { AdapterExecutionEvent } from '../adapter.js';
import { terminalEventTypes, visibleEventTypes, type ConformanceCaseId } from './contract.js';

export type ConformanceObservation = {
  events: AdapterExecutionEvent[];
  expectedText?: string;
  firstVisibleEventMs?: number;
  firstVisibleEventBudgetMs?: number;
  stopAttempts?: number;
  settledStopAttempts?: number;
  interventionDelivered?: boolean;
  nextExecutionStarted?: boolean;
  replayEventIds?: string[];
};

export type ConformanceCaseResult = {
  caseId: ConformanceCaseId;
  passed: boolean;
  failures: string[];
};

export const evaluateConformanceCase = (
  caseId: ConformanceCaseId,
  observation: ConformanceObservation,
): ConformanceCaseResult => {
  const failures = evaluators[caseId](observation);
  return { caseId, passed: failures.length === 0, failures };
};

const terminalEvents = (events: AdapterExecutionEvent[]) => events.filter(event => terminalEventTypes.has(event.type));
const eventTypes = (events: AdapterExecutionEvent[]) => new Set(events.map(event => event.type));
const requiresCancelled = (observation: ConformanceObservation) =>
  terminalEvents(observation.events).filter(event => event.type === 'execution.cancelled').length === 1
    ? []
    : ['expected exactly one execution.cancelled event'];

const evaluators: Record<ConformanceCaseId, (observation: ConformanceObservation) => string[]> = {
  'first-visible-event': observation => {
    const failures: string[] = [];
    const firstVisible = observation.events.find(event => visibleEventTypes.has(event.type));
    if (!firstVisible) failures.push('no visible event was emitted');
    if (observation.firstVisibleEventMs === undefined) failures.push('first-visible latency was not measured');
    if (observation.firstVisibleEventBudgetMs === undefined) failures.push('first-visible latency budget was not declared');
    if (observation.firstVisibleEventMs !== undefined && observation.firstVisibleEventBudgetMs !== undefined
      && observation.firstVisibleEventMs > observation.firstVisibleEventBudgetMs) failures.push('first-visible latency exceeded its budget');
    return failures;
  },
  'coherent-text-exactly-one-terminal': observation => {
    const failures: string[] = [];
    const text = observation.events
      .filter((event): event is Extract<AdapterExecutionEvent, { type: 'output.text.delta' }> => event.type === 'output.text.delta')
      .map(event => event.payload.text).join('');
    if (observation.expectedText === undefined) failures.push('expected coherent text was not declared');
    else if (text !== observation.expectedText) failures.push('text deltas did not form the expected text');
    if (terminalEvents(observation.events).length !== 1) failures.push('expected exactly one terminal event');
    return failures;
  },
  'stop-during-text': observation => eventTypes(observation.events).has('output.text.delta')
    ? requiresCancelled(observation)
    : ['stop was not exercised during a text stream'],
  'stop-during-tool': observation => eventTypes(observation.events).has('tool.started')
    ? requiresCancelled(observation)
    : ['stop was not exercised during an active tool'],
  'stop-with-pending-request': observation => eventTypes(observation.events).has('request.opened')
    ? requiresCancelled(observation)
    : ['stop was not exercised with a pending request'],
  'repeated-stop': observation => {
    const failures = requiresCancelled(observation);
    if ((observation.stopAttempts ?? 0) < 2) failures.push('stop was not called more than once');
    if (observation.settledStopAttempts !== observation.stopAttempts) failures.push('not every stop call settled');
    return failures;
  },
  'transport-death-typed-failure': observation => {
    const terminals = terminalEvents(observation.events);
    return terminals.length === 1 && terminals[0]?.type === 'execution.failed'
      ? []
      : ['transport death did not produce exactly one execution.failed event'];
  },
  'late-duplicate-terminal-ignored': observation => terminalEvents(observation.events).length === 1
    ? []
    : ['late or duplicate signal changed terminal cardinality'],
  'intervention-delivered': observation => observation.interventionDelivered
    && eventTypes(observation.events).has('execution.intervention.applied')
    ? []
    : ['intervention was not observably delivered'],
  'next-execution-after-stop': observation => observation.nextExecutionStarted
    ? requiresCancelled(observation)
    : ['next execution did not start after stop'],
  'replay-deduplicated': observation => {
    if (!observation.replayEventIds) return ['replay event identities were not captured'];
    return new Set(observation.replayEventIds).size === observation.replayEventIds.length
      ? []
      : ['replay contained duplicate accepted event identities'];
  },
  'stable-tool-identity': observation => {
    const tools = observation.events.filter(event => event.type.startsWith('tool.')) as Array<Extract<AdapterExecutionEvent, { type: `tool.${string}` }>>;
    if (!tools.some(event => event.type === 'tool.started')) return ['tool lifecycle has no started event'];
    if (!tools.some(event => ['tool.completed', 'tool.failed', 'tool.cancelled'].includes(event.type))) return ['tool lifecycle has no terminal event'];
    const identities = new Set(tools.map(event => `${event.payload.toolId}\u0000${event.payload.name}`));
    return identities.size === 1 ? [] : ['tool id or name changed during its lifecycle'];
  },
};
