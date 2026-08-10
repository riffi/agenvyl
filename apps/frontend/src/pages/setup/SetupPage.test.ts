import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import type {SetupHarnessCandidate,SetupState} from '@agenvyl/contracts';
import {Candidate,ConnectorOptions,FieldTitle,initialConnectorSelection,instanceConfig,isSetupPreview,mergeSetupHarnessSelection,setupCompletionRequest} from './SetupPage';

const candidate:SetupHarnessCandidate={type:'opencode',label:'OpenCode',cli:{found:true,command:'opencode',version:'1.17.20'},endpoint:{url:'http://127.0.0.1:4096',reachable:true},safeToSelect:true,supportsManagedServer:true};
const discoveryCache={state:'fresh' as const,refreshedAt:'2026-07-24T00:00:00.000Z',expiresAt:'2026-07-24T00:05:00.000Z'};

describe('setup harness configuration',()=>{
  it('enables setup preview only for an explicit development URL',()=>{
    expect(isSetupPreview('?preview=1',true)).toBe(true);
    expect(isSetupPreview('?preview=1',false)).toBe(false);
    expect(isSetupPreview('?preview=0',true)).toBe(false);
  });
  it('shows the harness icon in a connector option',()=>{
    const html=renderToStaticMarkup(createElement(Candidate,{candidate,checked:false,onChange:()=>undefined}));
    expect(html).toContain('aria-label="OpenCode"');
    expect(html).toContain('data-harness-type="opencode"');
    expect(html).toContain('data-harness-size="md"');
  });
  it('renders field help as a keyboard-focusable tooltip',()=>{
    const html=renderToStaticMarkup(createElement(FieldTitle,{label:'Workspace root',help:'Stores room files.'}));
    expect(html).toContain('tabindex="0"');expect(html).toContain('role="tooltip"');expect(html).toContain('Stores room files.');
  });
  it('completes setup without requiring a first-room title',()=>{
    expect(setupCompletionRequest({workspaceRoot:' C:/workspaces ',name:'User',handle:'user',route:null})).toEqual({locale:'en',workspace_root:'C:/workspaces',profile:{display_name:'User',handle:'user'},route:null});
  });

  it('renders selected runtime settings in a separate compact options section',()=>{
    const html=renderToStaticMarkup(createElement(ConnectorOptions,{
      selected:['opencode','codex'],
      agy:false,
      agyConfirmation:'',
      setAgyConfirmation:()=>undefined,
      openCodeManaged:true,
      setOpenCodeManaged:()=>undefined,
      claudeNeedsConfirmation:false,
      claudeOAuthConfirmation:'',
      setClaudeOAuthConfirmation:()=>undefined,
    }));
    expect(html).toContain('id="connector-options-title"');
    expect(html).toContain('Settings for the runtimes selected above.');
    expect(html).toContain('<em>OpenCode</em>');
    expect(html).not.toContain('<em>Codex</em>');
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(html).not.toContain('data-harness-type');
  });

  it('renders AGY, Claude, and Cursor confirmation phrases in the same options list',()=>{
    const html=renderToStaticMarkup(createElement(ConnectorOptions,{
      selected:[],
      agy:true,
      agyConfirmation:'AGY',
      setAgyConfirmation:()=>undefined,
      openCodeManaged:true,
      setOpenCodeManaged:()=>undefined,
      claudeNeedsConfirmation:true,
      claudeOAuthConfirmation:'CLAUDE OAUTH',
      setClaudeOAuthConfirmation:()=>undefined,
      cursorNeedsConfirmation:true,
      cursorConfirmation:'CURSOR',
      setCursorConfirmation:()=>undefined,
    }));
    expect(html).toContain('Confirm dangerous permission mode');
    expect(html).toContain('<em>AGY</em>');
    expect(html).toContain('placeholder="Type AGY"');
    expect(html).toContain('Confirm subscription OAuth');
    expect(html).toContain('<em>Claude</em>');
    expect(html).toContain('placeholder="Type CLAUDE OAUTH"');
    expect(html).toContain('Confirm experimental Cursor CLI');
    expect(html).toContain('placeholder="Type CURSOR"');
  });

  it('does not preselect unavailable configured connectors during first setup',()=>{
    const state:SetupState={completed:false,locale:'en',workspaceRoot:'C:/workspaces',discoveryCache,instances:[
      {id:'local-hermes',type:'hermes',enabled:true,status:'healthy'},
      {id:'local-opencode',type:'opencode',enabled:true,status:'healthy',managed:true},
      {id:'local-antigravity',type:'antigravity',enabled:true,status:'healthy'},
    ],candidates:[
      {type:'hermes',label:'Hermes',cli:{found:false,command:'hermes'},safeToSelect:false,supportsManagedServer:false},
      candidate,
      {type:'antigravity',label:'AGY',cli:{found:true,command:'agy'},safeToSelect:false,supportsManagedServer:false},
    ]};

    expect(initialConnectorSelection(state)).toEqual({selected:['opencode'],agy:false,openCodeManaged:true,claudeOAuthConfirmed:false,cursorConfirmed:false});
  });

  it('preserves configured selections after setup so unavailable connectors can be disabled explicitly',()=>{
    const state:SetupState={completed:true,locale:'en',workspaceRoot:'C:/workspaces',discoveryCache,instances:[{id:'local-hermes',type:'hermes',enabled:true,status:'unavailable'},{id:'local-antigravity',type:'antigravity',enabled:true,status:'healthy'}],candidates:[]};
    expect(initialConnectorSelection(state)).toEqual({selected:['hermes'],agy:true,openCodeManaged:true,claudeOAuthConfirmed:false,cursorConfirmed:false});
  });

  it('preserves managed OpenCode ownership after terminal setup made its endpoint reachable',()=>{
    expect(instanceConfig(candidate,{id:'local-opencode',type:'opencode',enabled:true,status:'healthy',managed:true,externalDirectoryRoots:['C:\\Shared']})).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true,externalDirectoryRoots:['C:\\Shared']});
  });
  it('enables managed OpenCode by default even when an endpoint is already reachable',()=>{
    expect(instanceConfig(candidate)).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true,externalDirectoryRoots:[]});
  });
  it('preserves an explicit OpenCode managed-server opt-out',()=>{
    expect(instanceConfig(candidate,{id:'local-opencode',type:'opencode',enabled:true,status:'healthy',managed:false})).toEqual({id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:false,externalDirectoryRoots:[]});
  });
  it('keeps Codex configuration permission-free and persists Claude confirmation',()=>{
    const codex:SetupHarnessCandidate={type:'codex',label:'Codex',cli:{found:true,command:'codex',version:'0.145.0',compatible:true},safeToSelect:true,supportsManagedServer:false};
    const claude:SetupHarnessCandidate={type:'claude',label:'Claude',cli:{found:true,command:'claude',version:'2.1.217',compatible:true},safeToSelect:true,supportsManagedServer:false,auth:{authenticated:true,kind:'subscription_oauth'},requiresConfirmation:'claude_oauth'};
    expect(instanceConfig(codex)).toEqual({id:'local-codex',type:'codex',enabled:true});
    expect(instanceConfig(claude,undefined,{claudeOAuthConfirmed:true})).toEqual({id:'local-claude',type:'claude',enabled:true,allowSubscriptionOAuth:true});
  });

  it('adds explicitly confirmed AGY without storing a connector permission mode',()=>{
    const agy:SetupHarnessCandidate={type:'antigravity',label:'AGY',cli:{found:true,command:'agy',version:'1.1.6',compatible:true},safeToSelect:false,supportsManagedServer:false};
    const state:SetupState={completed:false,locale:'en',workspaceRoot:'C:/workspaces',discoveryCache,candidates:[agy],instances:[]};
    expect(mergeSetupHarnessSelection(state,[],true)).toEqual([{id:'local-antigravity',type:'antigravity',enabled:true}]);
  });

  it('preserves custom ids, missing discovery entries, and multiple instances',()=>{
    const state:SetupState={completed:false,locale:'en',workspaceRoot:'C:/workspaces',discoveryCache,candidates:[candidate],instances:[
      {id:'custom-hermes',type:'hermes',enabled:true,endpoint:'http://127.0.0.1:9000',status:'unavailable'},
      {id:'custom-open',type:'opencode',enabled:true,managed:false,externalDirectoryRoots:['C:\\Shared'],status:'healthy'},
      {id:'custom-open-2',type:'opencode',enabled:true,managed:true,externalDirectoryRoots:[],status:'healthy'},
    ]};
    expect(mergeSetupHarnessSelection(state,[],false,{openCodeManaged:false})).toEqual([
      {id:'custom-hermes',type:'hermes',enabled:true,endpoint:'http://127.0.0.1:9000'},
      {id:'custom-open',type:'opencode',enabled:false,managed:false,externalDirectoryRoots:['C:\\Shared']},
      {id:'custom-open-2',type:'opencode',enabled:false,managed:true,externalDirectoryRoots:[]},
    ]);
  });
});
