import {describe,expect,it} from 'vitest';
import {selectSafeInstances,type SetupCandidate} from './setup.js';

describe('supervisor setup selection',()=>{it('selects every safe attachable harness except AGY',()=>{const candidates:SetupCandidate[]=[{type:'hermes',label:'Hermes',cli:{found:false},endpoint:{url:'http://127.0.0.1:8642',reachable:true},safeToSelect:true},{type:'opencode',label:'OpenCode',cli:{found:true},endpoint:{url:'http://127.0.0.1:4096',reachable:false},safeToSelect:true},{type:'antigravity',label:'AGY',cli:{found:true},safeToSelect:true}];expect(selectSafeInstances(candidates)).toEqual([{id:'local-hermes',type:'hermes',enabled:true,endpoint:'http://127.0.0.1:8642'},{id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true}]);});});
