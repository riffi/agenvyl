import type { AdapterExecutionEvent } from '../../adapter.js';
import type {TokenUsage} from '@agenvyl/connector-contract';
import { redactConnectorText } from '../../safety.js';

export type HermesMappedEvent =
  | { kind: 'event'; event: AdapterExecutionEvent; before?:AdapterExecutionEvent }
  | { kind: 'approval-request'; prompt: string; choices: string[] }
  | { kind: 'unsupported-interaction' };

export function mapHermesEvent(upstreamId: string, eventName: string | undefined, data: string): HermesMappedEvent | undefined {
  if (data === '[DONE]') return undefined;
  let decoded: unknown;
  try { decoded = JSON.parse(data) as unknown; } catch { return undefined; }
  if (!isRecord(decoded)) return undefined;
  const type = stringValue(eventName) ?? stringValue(decoded.event) ?? stringValue(decoded.type);
  if (!type) return undefined;

  if (type === 'assistant.delta' || type === 'message.delta') {
    const text = stringValue(decoded.delta) ?? stringValue(decoded.text);
    return text ? { kind: 'event', event: { type: 'output.text.delta', payload: { text } } } : undefined;
  }
  if (type.startsWith('tool.')) {
    const name = stringValue(decoded.tool_name) ?? stringValue(decoded.name) ?? stringValue(decoded.tool) ?? 'tool';
    const toolId = stringValue(decoded.tid) ?? stringValue(decoded.tool_call_id) ?? stringValue(decoded.tool_use_id)
      ?? stringValue(decoded.call_id) ?? stringValue(decoded.id) ?? `${upstreamId}:${name}`;
    const safeSummary = redactConnectorText(stringValue(decoded.preview) ?? stringValue(decoded.detail) ?? stringValue(decoded.delta) ?? '');
    const normalizedType = type === 'tool.started' ? 'tool.started' : type === 'tool.completed' ? 'tool.completed' : 'tool.updated';
    return { kind: 'event', event: { type: normalizedType, payload: { toolId, name, safeSummary } } };
  }
  if (type === 'run.completed') {const usage=tokenUsage(decoded.usage);return { kind: 'event',...(usage?{before:{type:'usage.updated',payload:{usage}} as AdapterExecutionEvent}:{}), event: { type: 'execution.completed', payload: {} } };}
  if (type === 'run.cancelled') return { kind: 'event', event: { type: 'execution.cancelled', payload: {} } };
  if (type === 'run.failed') {
    return { kind: 'event', event: { type: 'execution.failed', payload: { error: { code: 'hermes_run_failed', message: 'Hermes execution failed' } } } };
  }
  if (type === 'approval.request') {
    const prompt = redactConnectorText(stringValue(decoded.prompt) ?? stringValue(decoded.description) ?? stringValue(decoded.message) ?? 'Hermes requests approval');
    const choices = Array.isArray(decoded.choices)
      ? decoded.choices.filter((choice): choice is string => typeof choice === 'string' && approvalChoices.has(choice))
      : [];
    return { kind: 'approval-request', prompt, choices: choices.length ? [...new Set(choices)] : ['once', 'session', 'deny'] };
  }
  if (type === 'clarification.request') return { kind: 'unsupported-interaction' };
  return undefined;
}

const approvalChoices = new Set(['once', 'session', 'always', 'deny']);

function stringValue(value: unknown) { return typeof value === 'string' && value.length ? value : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function tokenUsage(value:unknown):TokenUsage|undefined{if(!isRecord(value))return;const input=count(value.input_tokens),output=count(value.output_tokens),total=value.total_tokens===undefined?undefined:count(value.total_tokens);if(input===undefined||output===undefined||(value.total_tokens!==undefined&&total===undefined))return;return{inputTokens:input,outputTokens:output,...(total===undefined?{}:{totalTokens:total})};}
function count(value:unknown){return Number.isSafeInteger(value)&&Number(value)>=0?Number(value):undefined;}
