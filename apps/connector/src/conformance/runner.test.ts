import { describe, expect, it } from 'vitest';
import type { AdapterExecutionEvent } from '../adapter.js';
import { conformanceCaseIds } from './contract.js';
import { evaluateConformanceCase, type ConformanceObservation } from './runner.js';

const text = (value: string): AdapterExecutionEvent => ({ type: 'output.text.delta', payload: { text: value } });
const cancelled = (): AdapterExecutionEvent => ({ type: 'execution.cancelled', payload: {} });
const completed = (): AdapterExecutionEvent => ({ type: 'execution.completed', payload: {} });
const failed = (): AdapterExecutionEvent => ({ type: 'execution.failed', payload: { error: { code: 'fixture_transport_died', message: 'Fixture transport died' } } });
const tool = (type: 'tool.started' | 'tool.updated' | 'tool.completed'): AdapterExecutionEvent => ({
  type,
  payload: { toolId: 'tool-1', name: 'Read', safeSummary: type },
});
const opened = (): AdapterExecutionEvent => ({ type: 'request.opened', payload: { request: { id: 'request-1', kind: 'approval', prompt: 'Continue?' } } });

const passingObservation = (caseId: typeof conformanceCaseIds[number]): ConformanceObservation => {
  if (caseId === 'first-visible-event') return { events: [text('ok'), completed()], firstVisibleEventMs: 5, firstVisibleEventBudgetMs: 100 };
  if (caseId === 'coherent-text-exactly-one-terminal') return { events: [text('hel'), text('lo'), completed()], expectedText: 'hello' };
  if (caseId === 'stop-during-text') return { events: [text('partial'), cancelled()] };
  if (caseId === 'stop-during-tool') return { events: [tool('tool.started'), cancelled()] };
  if (caseId === 'stop-with-pending-request') return { events: [opened(), cancelled()] };
  if (caseId === 'repeated-stop') return { events: [cancelled()], stopAttempts: 2, settledStopAttempts: 2 };
  if (caseId === 'transport-death-typed-failure') return { events: [failed()] };
  if (caseId === 'late-duplicate-terminal-ignored') return { events: [completed()] };
  if (caseId === 'intervention-delivered') return { events: [{ type: 'execution.intervention.applied', payload: { interventionId: 'intervention-1', text: 'Focus' } }], interventionDelivered: true };
  if (caseId === 'next-execution-after-stop') return { events: [cancelled()], nextExecutionStarted: true };
  if (caseId === 'replay-deduplicated') return { events: [], replayEventIds: ['epoch:1', 'epoch:2'] };
  return { events: [tool('tool.started'), tool('tool.updated'), tool('tool.completed')] };
};

describe('connector conformance runner', () => {
  it.each(conformanceCaseIds)('accepts a valid %s observation', caseId => {
    expect(evaluateConformanceCase(caseId, passingObservation(caseId))).toEqual({ caseId, passed: true, failures: [] });
  });

  it('detects an intentionally introduced terminal divergence', () => {
    const result = evaluateConformanceCase('coherent-text-exactly-one-terminal', {
      events: [text('answer'), completed(), failed()], expectedText: 'answer',
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('expected exactly one terminal event');
  });

  it('detects changed tool identity and duplicate replay identities', () => {
    const changedTool = evaluateConformanceCase('stable-tool-identity', {
      events: [tool('tool.started'), { type: 'tool.completed', payload: { toolId: 'tool-2', name: 'Read', safeSummary: 'done' } }],
    });
    expect(changedTool.passed).toBe(false);
    expect(evaluateConformanceCase('replay-deduplicated', { events: [], replayEventIds: ['1', '1'] }).passed).toBe(false);
  });
});
