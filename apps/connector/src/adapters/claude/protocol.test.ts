import {describe,expect,it} from 'vitest';
import {BoundedNdjsonDecoder} from './protocol.js';

describe('Claude NDJSON protocol',()=>{
  it('decodes fragmented UTF-8 messages',()=>{const decoder=new BoundedNdjsonDecoder();const bytes=Buffer.from('{"type":"assistant","text":"привет"}\n');expect(decoder.push(bytes.subarray(0,19))).toEqual([]);expect(decoder.push(bytes.subarray(19))).toEqual([{type:'assistant',text:'привет'}]);});
  it('rejects malformed and oversized lines',()=>{expect(()=>new BoundedNdjsonDecoder().push('{nope}\n')).toThrow('malformed');expect(()=>new BoundedNdjsonDecoder(16,32).push(`${JSON.stringify({type:'assistant',text:'x'.repeat(20)})}\n`)).toThrow(/limit/);expect(()=>new BoundedNdjsonDecoder(100,16).push('x'.repeat(17))).toThrow('buffer');});
});
