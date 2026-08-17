import {Buffer} from 'node:buffer';
import {describe,expect,it} from 'vitest';
import {AntigravityNdjsonDecoder,AntigravityProtocolError,antigravityResult,antigravityText,antigravityTool} from './protocol.js';

describe('Antigravity stream-json protocol',()=>{
  it('decodes split UTF-8 NDJSON and extracts progress events',()=>{
    const decoder=new AntigravityNdjsonDecoder(),line=JSON.stringify({event:'step_update',step_update:{step_index:7,state:'ACTIVE',step_type:'agent_response',text_delta:'Привет'}})+'\n',bytes=Buffer.from(line),split=bytes.indexOf(Buffer.from('в'))+1;
    expect(decoder.push(bytes.subarray(0,split))).toEqual([]);
    const [message]=decoder.push(bytes.subarray(split));
    expect(antigravityText(message!)).toBe('Привет');
    expect(decoder.finish()).toEqual([]);
  });

  it('extracts tool states and terminal metadata',()=>{
    expect(antigravityTool({event:'step_update',step_update:{step_index:3,state:'ACTIVE',step_type:'tool',tool_name:'run_command',tool_info:{parameters:{CommandLine:'npm test'}}}})).toEqual({id:'agy-step-3',name:'run_command',state:'active',parameters:{CommandLine:'npm test'}});
    expect(antigravityTool({event:'step_update',step_update:{step_index:3,state:'ERROR',step_type:'tool',tool_name:'run_command',tool_info:{error:{type:'TOOL_ERROR'}}}})).toEqual({id:'agy-step-3',name:'run_command',state:'failed',parameters:undefined});
    expect(antigravityResult({event:'result',result:{conversation_id:'conversation-1',status:'SUCCESS',response:'done',usage:{input_tokens:10,output_tokens:2,total_tokens:12,thinking_tokens:1,cache_read_tokens:5}}})).toEqual({conversationId:'conversation-1',status:'SUCCESS',response:'done',usage:{inputTokens:10,outputTokens:2,totalTokens:12,reasoningTokens:1,cacheReadTokens:5}});
  });

  it('rejects malformed, oversized and structurally invalid events',()=>{
    expect(()=>new AntigravityNdjsonDecoder().push('not-json\n')).toThrow(AntigravityProtocolError);
    expect(()=>new AntigravityNdjsonDecoder(8).push('{"event":"too-long"}\n')).toThrow('line limit');
    expect(()=>new AntigravityNdjsonDecoder(100,5).push('123456')).toThrow('output exceeded');
    expect(()=>new AntigravityNdjsonDecoder().push('{}\n')).toThrow('invalid stream-json event');
  });
});
