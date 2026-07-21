import {describe,expect,it,vi} from 'vitest';
import {discoverHarnesses} from './discovery.js';

describe('harness discovery',()=>{
  it('marks only attachable safe harnesses and keeps AGY behind a separate boundary',async()=>{
    const run=vi.fn(async(command:string)=>command==='agy'?{found:true,command,version:'1.1.3'}:{found:true,command,version:'1.0.0'}),request=vi.fn<typeof fetch>(async url=>new Response('',{status:String(url).includes('8642')?200:503}));
    const result=await discoverHarnesses({env:{},run,request});
    expect(result.candidates.map(candidate=>[candidate.type,candidate.safeToSelect,candidate.cli.compatible])).toEqual([['hermes',true,true],['opencode',true,true],['antigravity',false,true]]);
    expect(result.candidates[2].warning).toContain('separate');
  });
});
