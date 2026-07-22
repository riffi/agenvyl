import {describe,expect,it} from 'vitest';
import {claudeInvocation} from './process.js';

describe('Claude process invocation',()=>{
  it('quotes Windows npm shims without interpolating prompt or model',()=>{expect(claudeInvocation('C:\\Users\\Test User\\npm\\claude.cmd',['--model','claude-sonnet-4-5','--append-system-prompt-file','C:\\Temp Path\\context.txt'],'win32',{ComSpec:'cmd.exe'})).toEqual({file:'cmd.exe',args:['/d','/s','/c','""C:\\Users\\Test User\\npm\\claude.cmd" "--model" "claude-sonnet-4-5" "--append-system-prompt-file" "C:\\Temp Path\\context.txt""'],windowsVerbatimArguments:true});});
  it('rejects command-shell metacharacters',()=>{expect(()=>claudeInvocation('claude.cmd',['--model','safe & unsafe'],'win32',{})).toThrow('unsupported');});
});
