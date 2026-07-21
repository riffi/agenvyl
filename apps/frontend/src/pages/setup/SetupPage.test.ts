import {describe,expect,it} from 'vitest';
import type {SetupHarnessCandidate} from '@agenvyl/contracts';
import {instanceConfig} from './SetupPage';

const candidate:SetupHarnessCandidate={type:'opencode',label:'OpenCode',cli:{found:true,command:'opencode',version:'1.17.20'},endpoint:{url:'http://127.0.0.1:4096',reachable:true},safeToSelect:true,supportsManagedServer:true};

describe('setup harness configuration',()=>{
  it('preserves managed OpenCode ownership after terminal setup made its endpoint reachable',()=>{
    expect(instanceConfig(candidate,{id:'local-opencode',type:'opencode',status:'healthy',managed:true})).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true});
  });
  it('does not claim ownership of a reachable external OpenCode endpoint',()=>{
    expect(instanceConfig(candidate)).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096'});
  });
});
