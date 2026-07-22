import {describe,expect,it} from 'vitest';
import {JsonLineDecoder} from './app-server-client.js';

describe('Codex JSONL decoder',()=>{
  it('reassembles fragmented and multiple CRLF messages',()=>{const decoder=new JsonLineDecoder(100);expect(decoder.push('{"id":1')).toEqual([]);expect(decoder.push('}\r\n{"id":2}\n')).toEqual(['{"id":1}','{"id":2}']);});
  it('rejects oversized complete and fragmented lines',()=>{expect(()=>new JsonLineDecoder(3).push('1234\n')).toThrow('exceeded');const decoder=new JsonLineDecoder(3);decoder.push('12');expect(()=>decoder.push('34')).toThrow('exceeded');});
});
