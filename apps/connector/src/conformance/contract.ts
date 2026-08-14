import type { AdapterExecutionEvent } from '../adapter.js';

export const conformanceCaseIds = [
  'first-visible-event',
  'coherent-text-exactly-one-terminal',
  'stop-during-text',
  'stop-during-tool',
  'stop-with-pending-request',
  'repeated-stop',
  'transport-death-typed-failure',
  'late-duplicate-terminal-ignored',
  'intervention-delivered',
  'next-execution-after-stop',
  'replay-deduplicated',
  'stable-tool-identity',
] as const;

export type ConformanceCaseId = typeof conformanceCaseIds[number];

export const conformanceCaseTitles: Record<ConformanceCaseId, string> = {
  'first-visible-event': 'first visible event stays within budget',
  'coherent-text-exactly-one-terminal': 'text is coherent and terminal is emitted exactly once',
  'stop-during-text': 'stop settles an active text stream',
  'stop-during-tool': 'stop settles an active tool',
  'stop-with-pending-request': 'stop settles pending user input',
  'repeated-stop': 'repeated stop remains idempotent',
  'transport-death-typed-failure': 'transport death becomes execution.failed',
  'late-duplicate-terminal-ignored': 'late terminal signals cannot resettle execution',
  'intervention-delivered': 'declared intervention reaches the harness',
  'next-execution-after-stop': 'a new execution starts after stop',
  'replay-deduplicated': 'replay does not duplicate accepted events',
  'stable-tool-identity': 'tool identity is stable through its lifecycle',
};

export const terminalEventTypes = new Set<AdapterExecutionEvent['type']>([
  'execution.completed',
  'execution.failed',
  'execution.cancelled',
]);

export const visibleEventTypes = new Set<AdapterExecutionEvent['type']>([
  'output.text.delta',
  'output.reasoning.delta',
  'tool.started',
  'request.opened',
  ...terminalEventTypes,
]);
