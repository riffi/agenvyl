import type { AdapterExecutionEvent } from '../../adapter.js';
import type {TokenUsage} from '@agenvyl/connector-contract';
import { redactConnectorText } from '../../safety.js';
import {createHash} from 'node:crypto';

export type HermesMappedEvent =
  | { kind: 'event'; event: AdapterExecutionEvent; before?:AdapterExecutionEvent }
  | { kind: 'approval-request'; prompt: string; choices: string[] }
  | { kind: 'unsupported-interaction' };

export function mapHermesEvent(eventName: string | undefined, data: string,tools:HermesToolLifecycle): HermesMappedEvent | undefined {
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
    const explicitId = stringValue(decoded.tid) ?? stringValue(decoded.tool_call_id) ?? stringValue(decoded.tool_use_id)
      ?? stringValue(decoded.call_id) ?? stringValue(decoded.id);
    const safeSummary = redactConnectorText(stringValue(decoded.preview) ?? stringValue(decoded.detail) ?? stringValue(decoded.delta) ?? '');
    const normalizedType = type === 'tool.started' ? 'tool.started' : type === 'tool.completed' ? 'tool.completed' : 'tool.updated';
    const toolId=tools.resolve(normalizedType,name,explicitId);
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

export class HermesToolLifecycle{
  private readonly activeByName=new Map<string,string[]>();
  private sequence=0;
  private readonly executionHash:string;
  constructor(upstreamId:string){this.executionHash=createHash('sha256').update(upstreamId).digest('hex').slice(0,16);}
  resolve(type:'tool.started'|'tool.updated'|'tool.completed',name:string,explicitId?:string){
    const active=this.activeByName.get(name)??[];
    if(type==='tool.started'){
      const id=explicitId??this.syntheticId();
      if(!active.includes(id))active.push(id);
      this.activeByName.set(name,active);
      return id;
    }
    if(explicitId){
      if(type==='tool.completed')this.remove(active,explicitId,name);
      else if(!active.includes(explicitId)){active.push(explicitId);this.activeByName.set(name,active);}
      return explicitId;
    }
    const current=active[0];
    if(current){if(type==='tool.completed')this.remove(active,current,name);return current;}
    const id=this.syntheticId();
    if(type==='tool.updated')this.activeByName.set(name,[id]);
    return id;
  }
  private syntheticId(){this.sequence+=1;return`hermes-tool-${this.executionHash}-${this.sequence}`;}
  private remove(active:string[],id:string,name:string){const index=active.indexOf(id);if(index>=0)active.splice(index,1);if(active.length)this.activeByName.set(name,active);else this.activeByName.delete(name);}
}

const approvalChoices = new Set(['once', 'session', 'always', 'deny']);

function stringValue(value: unknown) { return typeof value === 'string' && value.length ? value : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function tokenUsage(value:unknown):TokenUsage|undefined{if(!isRecord(value))return;const input=count(value.input_tokens),output=count(value.output_tokens),total=value.total_tokens===undefined?undefined:count(value.total_tokens);if(input===undefined||output===undefined||(value.total_tokens!==undefined&&total===undefined))return;return{inputTokens:input,outputTokens:output,...(total===undefined?{}:{totalTokens:total})};}
function count(value:unknown){return Number.isSafeInteger(value)&&Number(value)>=0?Number(value):undefined;}
