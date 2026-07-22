import {describe,expect,it} from 'vitest';
import {addHarnessDraft,configurationOf,validDraft,type HarnessDraft} from './harnessSettingsModel';

const opencode:HarnessDraft={id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true,status:'healthy',capabilities:[],personas:[]};

describe('harness settings model',()=>{
  it('creates unique instances of the same harness type from discovery defaults',()=>{
    const next=addHarnessDraft('opencode',[opencode],[{type:'opencode',label:'OpenCode',cli:{found:true,command:'opencode'},endpoint:{url:'http://127.0.0.1:4096',reachable:false},safeToSelect:true,supportsManagedServer:true}]);
    expect(next).toMatchObject({id:'local-opencode-2',type:'opencode',endpoint:'http://127.0.0.1:4096',managed:true});
  });

  it('sends configuration fields without runtime and agent metadata',()=>{
    expect(configurationOf({...opencode,personas:[{id:'agent',name:'Builder',handle:'builder',archived:false}]})).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true});
  });

  it('rejects duplicate ids and unsafe endpoints',()=>{
    expect(validDraft([opencode,{...opencode}])).toBe(false);
    expect(validDraft([{...opencode,endpoint:'file:///tmp/opencode'}])).toBe(false);
  });
});
