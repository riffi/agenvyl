import {describe,expect,it} from 'vitest';
import {CursorNdjsonDecoder,cursorResult,cursorText,cursorTool} from './protocol.js';

describe('Cursor stream-json protocol',()=>{
  it('decodes chunked NDJSON and normalizes text, tools, and results',()=>{
    const decoder=new CursorNdjsonDecoder(),first=decoder.push('{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hel');
    const messages=[...first,...decoder.push('lo"}]}}\n{"type":"tool_call","subtype":"started","call_id":"tool-1","tool_call":{"readToolCall":{"args":{"path":"README.md"}}}}\n{"type":"result","subtype":"success","is_error":false,"result":"hello"}\n')];
    expect(cursorText(messages[0]!)).toBe('hello');
    expect(cursorTool(messages[1]!)).toEqual({id:'tool-1',name:'read',args:{path:'README.md'},completed:false});
    expect(cursorResult(messages[2]!)).toEqual({success:true,text:'hello'});
  });
  it('ignores unknown messages and fails closed for malformed or oversized lines',()=>{
    expect(cursorText({type:'future'})).toBe('');
    expect(()=>new CursorNdjsonDecoder().push('{bad}\n')).toThrow('malformed');
    expect(()=>new CursorNdjsonDecoder(8).push('{"type":"assistant"}\n')).toThrow('line limit');
  });
});
