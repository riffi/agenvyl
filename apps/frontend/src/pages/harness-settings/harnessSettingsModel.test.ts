import {describe,expect,it} from 'vitest';
import type {HarnessSettingsInstance} from '@agenvyl/contracts';
import {addHarnessDraft,configurationOf,groupHarnessInstances,harnessSettingsSummary,healthStatus,validDraft,type HarnessDraft} from './harnessSettingsModel';

const opencode:HarnessDraft={id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true,status:'healthy',capabilities:[],personas:[]};
const saved=(patch:Partial<HarnessSettingsInstance>={}):HarnessSettingsInstance=>({...opencode,status:'healthy',...patch});

describe('harness settings model',()=>{
  it('creates unique instances of the same harness type from discovery defaults',()=>{
    const next=addHarnessDraft('opencode',[opencode],[{type:'opencode',label:'OpenCode',cli:{found:true,command:'opencode'},endpoint:{url:'http://127.0.0.1:4096',reachable:true},safeToSelect:true,supportsManagedServer:true}]);
    expect(next).toMatchObject({id:'local-opencode-2',type:'opencode',endpoint:'http://127.0.0.1:4096',managed:true,externalDirectoryRoots:[],status:'draft'});
  });

  it('sends configuration fields without runtime and agent metadata',()=>{
    expect(configurationOf({...opencode,externalDirectoryRoots:['/srv/shared'],personas:[{id:'agent',name:'Builder',handle:'builder',archived:false}]})).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true,externalDirectoryRoots:['/srv/shared']});
  });

  it('keeps AGY instance configuration free of persona permissions',()=>{
    const agy:HarnessDraft={id:'local-antigravity',type:'antigravity',enabled:true,status:'healthy',capabilities:[],personas:[]};
    expect(configurationOf(agy)).toEqual({id:'local-antigravity',type:'antigravity',enabled:true});
  });

  it('rejects duplicate ids and unsafe endpoints',()=>{
    expect(validDraft([opencode,{...opencode}])).toBe(false);
    expect(validDraft([{...opencode,endpoint:'file:///tmp/opencode'}])).toBe(false);
    expect(validDraft([{...opencode,externalDirectoryRoots:['../shared']}])).toBe(false);
    expect(validDraft([{...opencode,externalDirectoryRoots:['/srv/*']}])).toBe(false);
    expect(validDraft([{...opencode,externalDirectoryRoots:['/srv/shared','/srv/shared/']}])).toBe(false);
  });

  it('separates disabled configuration from health and summarizes operational issues',()=>{
    const disabled=saved({enabled:false,status:'disabled'});
    expect(healthStatus(disabled)).toBeNull();
    expect(harnessSettingsSummary([saved(),saved({id:'degraded',status:'degraded'}),{...disabled,id:'off'}])).toEqual({configured:3,healthy:1,issues:1,disabled:1});
  });

  it('preserves runtime group order while prioritizing issues and disabled instances',()=>{
    const instances=[saved(),saved({id:'local-hermes',type:'hermes'}),saved({id:'open-unavailable',status:'unavailable'}),saved({id:'open-disabled',enabled:false,status:'disabled'})];
    const groups=groupHarnessInstances(instances);
    expect(groups.map(group=>group.type)).toEqual(['opencode','hermes']);
    expect(groups[0]).toMatchObject({grouped:true,instances:[{id:'open-unavailable'},{id:'local-opencode'},{id:'open-disabled'}]});
  });
});
