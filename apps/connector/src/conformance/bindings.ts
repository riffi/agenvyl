import type { HarnessType } from '@agenvyl/connector-contract';
import { conformanceCaseIds, type ConformanceCaseId } from './contract.js';

export type ConformanceEvidence = { file: string; test: string };
export type ConformanceDisposition =
  | { status: 'pass'; evidence: ConformanceEvidence }
  | { status: 'waiver'; reason: string };
export type ConformanceBinding = {
  harness: HarnessType;
  family: 'app-server' | 'process' | 'http-sse' | 'server-sdk' | 'final-only-process';
  cases: Record<ConformanceCaseId, ConformanceDisposition>;
};

export const shippedHarnessTypes = ['codex', 'claude', 'cursor', 'opencode', 'hermes', 'antigravity'] as const satisfies readonly HarnessType[];

const evidence = (file: string, test: string): ConformanceDisposition => ({ status: 'pass', evidence: { file, test } });
const waiver = (reason: string): ConformanceDisposition => ({ status: 'waiver', reason });
const adapterTest = (harness: HarnessType, test: string) => evidence(`apps/connector/src/adapters/${harness}/adapter.test.ts`, test);

const standardProcessCases = (harness: 'claude' | 'cursor') => ({
  'first-visible-event': adapterTest(harness, harness === 'claude' ? 'streams output, usage and exactly one terminal event' : 'streams text and tools without duplicating the terminal result'),
  'coherent-text-exactly-one-terminal': adapterTest(harness, harness === 'claude' ? 'streams output, usage and exactly one terminal event' : 'streams text and tools without duplicating the terminal result'),
  'stop-during-text': adapterTest(harness, 'uses the terminal text as fallback and supports cancellation'),
  'stop-during-tool': adapterTest(harness, 'uses the terminal text as fallback and supports cancellation'),
  'stop-with-pending-request': harness === 'claude'
    ? adapterTest(harness, 'cancels a pending MCP permission when its client request is aborted')
    : waiver('Cursor agent stream exposes no approval, clarification, or elicitation request transport.'),
  'repeated-stop': adapterTest(harness, 'uses the terminal text as fallback and supports cancellation'),
  'transport-death-typed-failure': adapterTest(harness, 'isolates concurrent processes and normalizes process failures'),
  'late-duplicate-terminal-ignored': adapterTest(harness, harness === 'claude' ? 'streams output, usage and exactly one terminal event' : 'streams text and tools without duplicating the terminal result'),
  'intervention-delivered': waiver(`${harness === 'claude' ? 'Claude' : 'Cursor'} does not declare an intervention capability in the Connector adapter contract.`),
  'next-execution-after-stop': adapterTest(harness, 'isolates concurrent processes and normalizes process failures'),
  'replay-deduplicated': waiver(`${harness === 'claude' ? 'Claude' : 'Cursor'} is a fresh-process transport; durable replay is owned by ExecutionRegistry above the adapter boundary.`),
  'stable-tool-identity': adapterTest(harness, harness === 'claude' ? 'separates assistant messages while preserving deltas within one message' : 'streams text and tools without duplicating the terminal result'),
}) satisfies Record<ConformanceCaseId, ConformanceDisposition>;

export const conformanceBindings: readonly ConformanceBinding[] = [
  {
    harness: 'codex', family: 'app-server', cases: {
      'first-visible-event': adapterTest('codex', 'streams text, reasoning, tools, usage, approvals and structured clarification'),
      'coherent-text-exactly-one-terminal': adapterTest('codex', 'separates distinct agent-authored items without splitting deltas from one item'),
      'stop-during-text': adapterTest('codex', 'force closes a lone app-server when an interrupted turn never settles'),
      'stop-during-tool': adapterTest('codex', 'lets Stop win before a redirected turn starts'),
      'stop-with-pending-request': adapterTest('codex', 'streams text, reasoning, tools, usage, approvals and structured clarification'),
      'repeated-stop': adapterTest('codex', 'keeps Stop authoritative during the app-server turn activation race'),
      'transport-death-typed-failure': adapterTest('codex', 'isolates concurrent executions and emits terminal only after its process tree closes'),
      'late-duplicate-terminal-ignored': adapterTest('codex', 'continues after the old turn wins the completion race'),
      'intervention-delivered': adapterTest('codex', 'interrupts and starts a redirected turn in the same thread before releasing new output'),
      'next-execution-after-stop': adapterTest('codex', 'supports concurrent threads and interrupts only the selected turn'),
      'replay-deduplicated': waiver('Codex native continuation resumes without adapter replay; durable event replay is owned by ExecutionRegistry.'),
      'stable-tool-identity': adapterTest('codex', 'streams text, reasoning, tools, usage, approvals and structured clarification'),
    },
  },
  { harness: 'claude', family: 'process', cases: standardProcessCases('claude') },
  { harness: 'cursor', family: 'process', cases: standardProcessCases('cursor') },
  {
    harness: 'opencode', family: 'server-sdk', cases: {
      'first-visible-event': adapterTest('opencode', 'normalizes only matching text deltas and the terminal idle event'),
      'coherent-text-exactly-one-terminal': adapterTest('opencode', 'separates text parts while preserving deltas within one part'),
      'stop-during-text': adapterTest('opencode', 'inspects active status and aborts the matching session on stop'),
      'stop-during-tool': adapterTest('opencode', 'normalizes native tool states without exposing inputs, outputs, metadata, or errors'),
      'stop-with-pending-request': adapterTest('opencode', 'clears a pending approval when stopping and still cleans local state if SDK abort fails'),
      'repeated-stop': adapterTest('opencode', 'aborts and deletes active sessions when the adapter closes'),
      'transport-death-typed-failure': adapterTest('opencode', 'keeps repeated retries transient until one final session failure'),
      'late-duplicate-terminal-ignored': adapterTest('opencode', 'normalizes only matching text deltas and the terminal idle event'),
      'intervention-delivered': adapterTest('opencode', 'interrupts an active turn and continues the same session with the original configuration'),
      'next-execution-after-stop': adapterTest('opencode', 'keeps a shared directory instance alive until its last active session ends'),
      'replay-deduplicated': waiver('OpenCode resumes its native session without adapter replay; durable event replay is owned by ExecutionRegistry.'),
      'stable-tool-identity': adapterTest('opencode', 'normalizes native tool states without exposing inputs, outputs, metadata, or errors'),
    },
  },
  {
    harness: 'hermes', family: 'http-sse', cases: {
      'first-visible-event': adapterTest('hermes', 'normalizes text, tool, and terminal events without exposing tool arguments'),
      'coherent-text-exactly-one-terminal': adapterTest('hermes', 'normalizes text, tool, and terminal events without exposing tool arguments'),
      'stop-during-text': adapterTest('hermes', 'inspects status and stops an upstream execution'),
      'stop-during-tool': adapterTest('hermes', 'inspects status and stops an upstream execution'),
      'stop-with-pending-request': adapterTest('hermes', 'opens a stable approval request and resolves it through the Hermes endpoint'),
      'repeated-stop': adapterTest('hermes', 'inspects status and stops an upstream execution'),
      'transport-death-typed-failure': adapterTest('hermes', 'fails closed and stops Hermes when an unsupported clarification appears'),
      'late-duplicate-terminal-ignored': adapterTest('hermes', 'normalizes text, tool, and terminal events without exposing tool arguments'),
      'intervention-delivered': waiver('Hermes HTTP/SSE transport does not declare an intervention capability.'),
      'next-execution-after-stop': adapterTest('hermes', 'creates a fresh Hermes run with the canonical workspace and env-only auth'),
      'replay-deduplicated': waiver('Hermes adapter streams a live SSE response; durable replay and deduplication are owned by ExecutionRegistry.'),
      'stable-tool-identity': adapterTest('hermes', 'assigns distinct FIFO lifecycle ids to repeated id-less tools'),
    },
  },
  {
    harness: 'antigravity', family: 'final-only-process', cases: {
      'first-visible-event': adapterTest('antigravity', 'runs one fresh process with exact routing, cwd, auto-update guard and deterministic flattened context'),
      'coherent-text-exactly-one-terminal': adapterTest('antigravity', 'runs one fresh process with exact routing, cwd, auto-update guard and deterministic flattened context'),
      'stop-during-text': waiver('Antigravity is a final-only print transport and exposes no active text stream.'),
      'stop-during-tool': waiver('Antigravity is a final-only print transport and exposes no tool lifecycle.'),
      'stop-with-pending-request': waiver('Antigravity print mode exposes no approval, clarification, or elicitation requests.'),
      'repeated-stop': adapterTest('antigravity', 'terminates a stubborn process tree and reports cancellation'),
      'transport-death-typed-failure': adapterTest('antigravity', 'fails closed for unsupported modes, oversized prompts, empty output and non-zero exits'),
      'late-duplicate-terminal-ignored': adapterTest('antigravity', 'runs one fresh process with exact routing, cwd, auto-update guard and deterministic flattened context'),
      'intervention-delivered': waiver('Antigravity print mode does not declare an intervention capability.'),
      'next-execution-after-stop': adapterTest('antigravity', 'terminates a stubborn process tree and reports cancellation'),
      'replay-deduplicated': waiver('Antigravity is a fresh final-only process; durable replay is owned by ExecutionRegistry.'),
      'stable-tool-identity': waiver('Antigravity print mode exposes no tool lifecycle.'),
    },
  },
] as const;

export const validateConformanceBindings = (bindings: readonly ConformanceBinding[]) => {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const binding of bindings) {
    if (seen.has(binding.harness)) errors.push(`duplicate binding for ${binding.harness}`);
    seen.add(binding.harness);
    for (const caseId of conformanceCaseIds) {
      const disposition = binding.cases[caseId];
      if (!disposition) { errors.push(`${binding.harness}/${caseId}: missing disposition`); continue; }
      if (disposition.status === 'waiver' && !disposition.reason.trim()) errors.push(`${binding.harness}/${caseId}: waiver reason is empty`);
      if (disposition.status === 'pass' && (!disposition.evidence.file.trim() || !disposition.evidence.test.trim())) errors.push(`${binding.harness}/${caseId}: evidence is incomplete`);
    }
  }
  for (const harness of shippedHarnessTypes) if (!seen.has(harness)) errors.push(`missing shipped harness binding: ${harness}`);
  for (const harness of seen) if (!shippedHarnessTypes.includes(harness as HarnessType)) errors.push(`unknown harness binding: ${harness}`);
  return errors;
};

export const formatConformanceReport = (bindings: readonly ConformanceBinding[]) => bindings.flatMap(binding => [
  `${binding.harness} (${binding.family})`,
  ...conformanceCaseIds.map(caseId => {
    const disposition = binding.cases[caseId];
    return disposition.status === 'pass'
      ? `  PASS   ${caseId} — ${disposition.evidence.test}`
      : `  WAIVER ${caseId} — ${disposition.reason}`;
  }),
]).join('\n');
