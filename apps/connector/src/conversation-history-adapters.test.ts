import {Buffer} from 'node:buffer';
import {describe,expect,it} from 'vitest';
import type {AdapterStartExecutionRequest} from './adapter.js';
import {experimentalTailV1ConversationHistory} from './conversation-history.js';
import {boundedAntigravityPrompt} from './adapters/antigravity/adapter.js';
import {claudeContext} from './adapters/claude/adapter.js';
import {codexContext} from './adapters/codex/adapter.js';
import {cursorPrompt} from './adapters/cursor/adapter.js';
import {hermesRunBody} from './adapters/hermes/adapter.js';
import {openCodeSystemContext} from './adapters/opencode/adapter.js';

describe('tail-v1 adapter contract',()=>{
  it('gives all six harnesses the same bounded history while keeping system and current input separate',()=>{
    const request=longRequest(),expected=experimentalTailV1ConversationHistory(request.input.history).history;
    const histories=[
      xmlHistory(codexContext(request)),
      xmlHistory(claudeContext(request)),
      JSON.parse(openCodeSystemContext(request).split('\n').at(-1)!),
      hermesRunBody(request).conversation_history,
      jsonPrompt(cursorPrompt(request)).conversationHistory,
      jsonPrompt(boundedAntigravityPrompt(request,()=>true)).conversationHistory,
    ];
    for(const history of histories)expect(history).toEqual(expected);
    expect(histories.every(history=>!JSON.stringify(history).includes('CURRENT-SENTINEL'))).toBe(true);
    expect(histories.every(history=>!JSON.stringify(history).includes('SYSTEM-SENTINEL'))).toBe(true);
  });

  it('keeps a long-room Cursor prompt below its secondary 120 KiB guard when current input is small',()=>{
    expect(Buffer.byteLength(cursorPrompt(longRequest()),'utf8')).toBeLessThan(120*1_024);
  });

  it('lets Antigravity reduce tail-v1 further without dropping the newest item',()=>{
    const request=longRequest(),prompt=boundedAntigravityPrompt(request,value=>Buffer.byteLength(value,'utf8')<45_000),payload=jsonPrompt(prompt);
    expect(payload.conversationHistory.length).toBeGreaterThan(0);
    expect(payload.conversationHistory.at(-1)).toEqual(experimentalTailV1ConversationHistory(request.input.history).history.at(-1));
    expect(payload.currentUserMessage).toContain('CURRENT-SENTINEL');
  });
});

const longRequest=():AdapterStartExecutionRequest=>({
  executionId:'tail-contract',harnessInstanceId:'local',modelId:'model',
  executionProfile:{workflowMode:'work',reasoningEffort:null,permissionProfileId:'accept-edits',agentVariantId:null,planEnforcement:null},
  workspace:{roomId:'room',relativePath:'.',absolutePath:'C:/workspace/room'},
  input:{
    systemPrompt:'SYSTEM-SENTINEL '+'s'.repeat(30_000),
    history:Array.from({length:12},(_,index)=>({role:index%2?'assistant' as const:'user' as const,content:`history-${index}-`+'x'.repeat(10_000)})),
    message:'CURRENT-SENTINEL '+'m'.repeat(1_000),
  },
});

const xmlHistory=(value:string)=>JSON.parse(value.match(/<AgenvylConversationHistory>\n([\s\S]*?)\n<\/AgenvylConversationHistory>/)?.[1]??'null');
const jsonPrompt=(value:string)=>JSON.parse(value.slice(value.indexOf('\n')+1)) as {conversationHistory:Array<{role:string;content:string}>;currentUserMessage:string};
