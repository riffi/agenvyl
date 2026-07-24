import {describe,expect,it} from 'vitest';
import {addHarnessDraft,configurationOf,harnessCandidateDetail,harnessCandidateState,validDraft,type HarnessDraft} from './harnessSettingsModel';

const opencode:HarnessDraft={id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true,status:'healthy',capabilities:[],personas:[]};

describe('harness settings model',()=>{
  it('creates unique instances of the same harness type from discovery defaults',()=>{
    const next=addHarnessDraft('opencode',[opencode],[{type:'opencode',label:'OpenCode',cli:{found:true,command:'opencode'},endpoint:{url:'http://127.0.0.1:4096',reachable:true},safeToSelect:true,supportsManagedServer:true}]);
    expect(next).toMatchObject({id:'local-opencode-2',type:'opencode',endpoint:'http://127.0.0.1:4096',managed:true,externalDirectoryRoots:[],status:'draft'});
  });

  it('sends configuration fields without runtime and agent metadata',()=>{
    expect(configurationOf({...opencode,externalDirectoryRoots:['/srv/shared'],personas:[{id:'agent',name:'Builder',handle:'builder',archived:false}]})).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true,externalDirectoryRoots:['/srv/shared']});
  });

  it('rejects duplicate ids and unsafe endpoints',()=>{
    expect(validDraft([opencode,{...opencode}])).toBe(false);
    expect(validDraft([{...opencode,endpoint:'file:///tmp/opencode'}])).toBe(false);
    expect(validDraft([{...opencode,externalDirectoryRoots:['../shared']}])).toBe(false);
    expect(validDraft([{...opencode,externalDirectoryRoots:['/srv/*']}])).toBe(false);
    expect(validDraft([{...opencode,externalDirectoryRoots:['/srv/shared','/srv/shared/']}])).toBe(false);
  });

  it('keeps discovery readiness separate from saved connection state',()=>{
    const ready={type:'codex',label:'Codex',cli:{found:true,command:'codex',version:'0.145.0',compatible:true},safeToSelect:true,supportsManagedServer:false} as const;
    expect(harnessCandidateState(ready,false)).toBe('ready');
    expect(harnessCandidateState(ready,true)).toBe('connected');
    expect(harnessCandidateState({...ready,safeToSelect:false,warning:'Run codex login.'},false)).toBe('setup');
    expect(harnessCandidateDetail({...ready,safeToSelect:false,warning:'Run codex login.'},'setup')).toBe('Run codex login.');
  });
});
