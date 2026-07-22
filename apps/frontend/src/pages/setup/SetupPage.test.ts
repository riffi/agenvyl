import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import type {SetupHarnessCandidate,SetupState} from '@agenvyl/contracts';
import {Candidate,initialConnectorSelection,instanceConfig} from './SetupPage';

const candidate:SetupHarnessCandidate={type:'opencode',label:'OpenCode',cli:{found:true,command:'opencode',version:'1.17.20'},endpoint:{url:'http://127.0.0.1:4096',reachable:true},safeToSelect:true,supportsManagedServer:true};

describe('setup harness configuration',()=>{
  it('shows the harness icon in a connector option',()=>{
    const html=renderToStaticMarkup(createElement(Candidate,{candidate,checked:false,onChange:()=>undefined}));
    expect(html).toContain('aria-label="OpenCode"');
    expect(html).toContain('data-harness-type="opencode"');
    expect(html).toContain('data-harness-size="md"');
  });

  it('does not preselect unavailable configured connectors during first setup',()=>{
    const state:SetupState={completed:false,locale:'en',workspaceRoot:'C:/workspaces',instances:[
      {id:'local-hermes',type:'hermes',status:'healthy'},
      {id:'local-opencode',type:'opencode',status:'healthy',managed:true},
      {id:'local-antigravity',type:'antigravity',status:'healthy'},
    ],candidates:[
      {type:'hermes',label:'Hermes',cli:{found:false,command:'hermes'},safeToSelect:false,supportsManagedServer:false},
      candidate,
      {type:'antigravity',label:'AGY',cli:{found:true,command:'agy'},safeToSelect:false,supportsManagedServer:false},
    ]};

    expect(initialConnectorSelection(state)).toEqual({selected:['opencode'],agy:false});
  });

  it('preserves configured selections after setup so unavailable connectors can be disabled explicitly',()=>{
    const state:SetupState={completed:true,locale:'en',workspaceRoot:'C:/workspaces',instances:[{id:'local-hermes',type:'hermes',status:'unavailable'},{id:'local-antigravity',type:'antigravity',status:'healthy'}],candidates:[]};
    expect(initialConnectorSelection(state)).toEqual({selected:['hermes'],agy:true});
  });

  it('preserves managed OpenCode ownership after terminal setup made its endpoint reachable',()=>{
    expect(instanceConfig(candidate,{id:'local-opencode',type:'opencode',status:'healthy',managed:true})).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true});
  });
  it('does not claim ownership of a reachable external OpenCode endpoint',()=>{
    expect(instanceConfig(candidate)).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096'});
  });
});
