import {describe,expect,it} from 'vitest';
import {mergeConnectorSelection,selectSafeInstances,type SetupCandidate,type SetupState} from './setup.js';

describe('supervisor setup selection',()=>{it('selects every safe attachable harness except confirmation-gated candidates and manages OpenCode by default',()=>{const candidates:SetupCandidate[]=[{type:'hermes',label:'Hermes',cli:{found:false},endpoint:{url:'http://127.0.0.1:8642',reachable:true},safeToSelect:true},{type:'opencode',label:'OpenCode',cli:{found:true},endpoint:{url:'http://127.0.0.1:4096',reachable:true},safeToSelect:true},{type:'antigravity',label:'AGY',cli:{found:true},safeToSelect:true},{type:'claude',label:'Claude',cli:{found:true,version:'2.1.217'},safeToSelect:true,requiresConfirmation:'claude_oauth'}];expect(selectSafeInstances(candidates)).toEqual([{id:'local-hermes',type:'hermes',enabled:true,endpoint:'http://127.0.0.1:8642'},{id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true,externalDirectoryRoots:[]}]);});});

describe('lossless supervisor setup merge',()=>{
  it('keeps configured instances when discovery is empty',()=>{
    const state:SetupState={completed:true,candidates:[],instances:[{id:'custom-hermes',type:'hermes',enabled:true,endpoint:'http://127.0.0.1:9000',status:'unavailable'}]};
    expect(mergeConnectorSelection(state,[],false)).toEqual([{id:'custom-hermes',type:'hermes',enabled:true,endpoint:'http://127.0.0.1:9000'}]);
  });

  it('preserves multiple ids and disables visible instances without deleting them',()=>{
    const state:SetupState={completed:true,candidates:[{type:'opencode',label:'OpenCode',cli:{found:true},safeToSelect:true}],instances:[
      {id:'custom-open',type:'opencode',enabled:true,managed:false,externalDirectoryRoots:['/srv/shared'],status:'healthy'},
      {id:'custom-open-2',type:'opencode',enabled:true,managed:true,externalDirectoryRoots:[],status:'healthy'},
    ]};
    expect(mergeConnectorSelection(state,[],false)).toEqual([
      {id:'custom-open',type:'opencode',enabled:false,managed:false,externalDirectoryRoots:['/srv/shared']},
      {id:'custom-open-2',type:'opencode',enabled:false,managed:true,externalDirectoryRoots:[]},
    ]);
  });
});
