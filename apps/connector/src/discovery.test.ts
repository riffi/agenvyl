import {describe,expect,it,vi} from 'vitest';
import {commandInvocation,discoverHarnesses,runVersion} from './discovery.js';

describe('harness discovery',()=>{
  it('marks only attachable safe harnesses and keeps AGY behind a separate boundary',async()=>{
    const run=vi.fn(async(command:string)=>command==='agy'?{found:true,command,version:'1.1.3'}:{found:true,command,version:'1.0.0'}),request=vi.fn<typeof fetch>(async url=>new Response('',{status:String(url).includes('8642')?200:503}));
    const result=await discoverHarnesses({env:{},run,request});
    expect(result.candidates.map(candidate=>[candidate.type,candidate.safeToSelect,candidate.cli.compatible])).toEqual([['hermes',true,true],['opencode',true,true],['antigravity',false,true]]);
    expect(result.candidates[2].warning).toContain('separate');
  });
  it('resolves and executes npm .cmd shims on Windows',async()=>{const execute=vi.fn(async(file:string)=>file==='where.exe'?{stdout:'C:\\Users\\Vladimir\\AppData\\Roaming\\npm\\opencode.cmd\r\n',stderr:''}:{stdout:'opencode 1.2.3\r\n',stderr:''});await expect(runVersion('opencode',{platform:'win32',env:{ComSpec:'C:\\Windows\\System32\\cmd.exe'},execute})).resolves.toEqual({found:true,command:'opencode',version:'1.2.3'});expect(execute.mock.calls).toEqual([['where.exe',['opencode'],expect.any(Object)],['C:\\Windows\\System32\\cmd.exe',['/d','/s','/c','""C:\\Users\\Vladimir\\AppData\\Roaming\\npm\\opencode.cmd" --version"'],expect.any(Object)]]);});
  it('builds a safe managed-server invocation for Windows npm shims',()=>{expect(commandInvocation('C:\\Users\\Vladimir\\AppData\\Roaming\\npm\\opencode.cmd',['serve','--hostname','127.0.0.1','--port','4096'],'win32',{ComSpec:'cmd.exe'})).toEqual({file:'cmd.exe',args:['/d','/s','/c','""C:\\Users\\Vladimir\\AppData\\Roaming\\npm\\opencode.cmd" serve --hostname 127.0.0.1 --port 4096"']});});
});
