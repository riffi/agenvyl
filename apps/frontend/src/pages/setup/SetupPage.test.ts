import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import type {SetupHarnessCandidate,SetupState} from '@agenvyl/contracts';
import {Candidate,ConnectorOptions,initialConnectorSelection,instanceConfig} from './SetupPage';

const candidate:SetupHarnessCandidate={type:'opencode',label:'OpenCode',cli:{found:true,command:'opencode',version:'1.17.20'},endpoint:{url:'http://127.0.0.1:4096',reachable:true},safeToSelect:true,supportsManagedServer:true};
const discoveryCache={state:'fresh' as const,refreshedAt:'2026-07-24T00:00:00.000Z',expiresAt:'2026-07-24T00:05:00.000Z'};

describe('setup harness configuration',()=>{
  it('shows the harness icon in a connector option',()=>{
    const html=renderToStaticMarkup(createElement(Candidate,{candidate,checked:false,onChange:()=>undefined}));
    expect(html).toContain('aria-label="OpenCode"');
    expect(html).toContain('data-harness-type="opencode"');
    expect(html).toContain('data-harness-size="md"');
  });

  it('renders selected runtime settings in a separate compact options section',()=>{
    const html=renderToStaticMarkup(createElement(ConnectorOptions,{
      selected:['opencode','codex'],
      openCodeManaged:true,
      setOpenCodeManaged:()=>undefined,
      codexDangerFullAccess:false,
      setCodexDangerFullAccess:()=>undefined,
      codexConfirmation:'',
      setCodexConfirmation:()=>undefined,
      claudeNeedsConfirmation:false,
      claudeOAuthConfirmation:'',
      setClaudeOAuthConfirmation:()=>undefined,
    }));
    expect(html).toContain('id="connector-options-title"');
    expect(html).toContain('Settings for the runtimes selected above.');
    expect(html).toContain('<em>OpenCode</em>');
    expect(html).toContain('<em>Codex</em>');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).not.toContain('data-harness-type');
  });

  it('does not preselect unavailable configured connectors during first setup',()=>{
    const state:SetupState={completed:false,locale:'en',workspaceRoot:'C:/workspaces',discoveryCache,instances:[
      {id:'local-hermes',type:'hermes',status:'healthy'},
      {id:'local-opencode',type:'opencode',status:'healthy',managed:true},
      {id:'local-antigravity',type:'antigravity',status:'healthy'},
    ],candidates:[
      {type:'hermes',label:'Hermes',cli:{found:false,command:'hermes'},safeToSelect:false,supportsManagedServer:false},
      candidate,
      {type:'antigravity',label:'AGY',cli:{found:true,command:'agy'},safeToSelect:false,supportsManagedServer:false},
    ]};

    expect(initialConnectorSelection(state)).toEqual({selected:['opencode'],agy:false,openCodeManaged:true,codexDangerFullAccess:false,claudeOAuthConfirmed:false});
  });

  it('preserves configured selections after setup so unavailable connectors can be disabled explicitly',()=>{
    const state:SetupState={completed:true,locale:'en',workspaceRoot:'C:/workspaces',discoveryCache,instances:[{id:'local-hermes',type:'hermes',status:'unavailable'},{id:'local-antigravity',type:'antigravity',status:'healthy'}],candidates:[]};
    expect(initialConnectorSelection(state)).toEqual({selected:['hermes'],agy:true,openCodeManaged:true,codexDangerFullAccess:false,claudeOAuthConfirmed:false});
  });

  it('preserves managed OpenCode ownership after terminal setup made its endpoint reachable',()=>{
    expect(instanceConfig(candidate,{id:'local-opencode',type:'opencode',status:'healthy',managed:true,externalDirectoryRoots:['C:\\Shared']})).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true,externalDirectoryRoots:['C:\\Shared']});
  });
  it('enables managed OpenCode by default even when an endpoint is already reachable',()=>{
    expect(instanceConfig(candidate)).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true,externalDirectoryRoots:[]});
  });
  it('preserves an explicit OpenCode managed-server opt-out',()=>{
    expect(instanceConfig(candidate,{id:'local-opencode',type:'opencode',status:'healthy',managed:false})).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:false,externalDirectoryRoots:[]});
  });
  it('persists explicit Codex and Claude confirmations separately from credentials',()=>{
    const codex:SetupHarnessCandidate={type:'codex',label:'Codex',cli:{found:true,command:'codex',version:'0.145.0',compatible:true},safeToSelect:true,supportsManagedServer:false};
    const claude:SetupHarnessCandidate={type:'claude',label:'Claude',cli:{found:true,command:'claude',version:'2.1.217',compatible:true},safeToSelect:true,supportsManagedServer:false,auth:{authenticated:true,kind:'subscription_oauth'},requiresConfirmation:'claude_oauth'};
    expect(instanceConfig(codex,undefined,{codexDangerFullAccess:true})).toEqual({id:'local-codex',type:'codex',enabled:true,allowDangerFullAccess:true});
    expect(instanceConfig(claude,undefined,{claudeOAuthConfirmed:true})).toEqual({id:'local-claude',type:'claude',enabled:true,allowSubscriptionOAuth:true});
  });
});
