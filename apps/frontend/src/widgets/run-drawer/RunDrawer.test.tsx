import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import type {Persona} from '../../entities/persona';
import type {Run} from '../../entities/run';
import {RunDrawer} from './RunDrawer';

const persona:Persona={id:'persona-1',handle:'coder',name:'Coder',color:'#64748b',requested_model:'current/model',effective_model:null,harness_instance_id:'current-instance',harness_type:'other',model_id:'current/model',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,group_id:null,archived_at:null};
const run:Run={id:'run-2',messageId:'message-1',agent:'coder',requestedModel:'provider/model-v1',harnessInstanceId:'local-opencode',harnessType:'opencode',modelId:'provider/model-v1',executionProfile:{workflowMode:'work',requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:null,agentVariantId:'build',implementationPlanVersionId:null},status:'streaming',connector:{state:'active',checkpointed:true},text:'answer',tools:[],attemptNumber:2};

describe('RunDrawer lifecycle snapshot',()=>{
  it('renders the persisted route and checkpoint when the current catalog has changed',()=>{
    const html=renderToStaticMarkup(<RunDrawer run={run} persona={persona} close={vi.fn()}/>);
    expect(html).toContain('local-opencode · opencode');
    expect(html).toContain('provider/model-v1');
    expect(html).toContain('build');
    expect(html).toContain('Connector is running the task');
    expect(html).toContain('durable checkpoint');
    expect(html).toContain('<code>2</code>');
    expect(html).not.toContain('current/model');
  });

  it('explains a persisted Connector loss without exposing raw checkpoint identifiers',()=>{
    const html=renderToStaticMarkup(<RunDrawer run={{...run,status:'failed',connector:{state:'lost',checkpointed:true},errorCode:'connector_restarted'}} persona={persona} close={vi.fn()}/>);
    expect(html).toContain('Connector lost the run');
    expect(html).not.toContain('connector_execution_id');
    expect(html).not.toContain('connector_epoch');
    expect(html).not.toContain('connector_cursor');
  });

  it('shows only the normalized immutable token counters',()=>{
    const html=renderToStaticMarkup(<RunDrawer run={{...run,usage:{inputTokens:1234,outputTokens:56,reasoningTokens:7}}} persona={persona} close={vi.fn()}/>);
    expect(html).toContain('Input tokens');expect(html).toContain('1,234');expect(html).toContain('Output tokens');expect(html).toContain('56');expect(html).toContain('Total tokens');expect(html).toContain('not reported');expect(html).not.toContain('cost');
  });

  it('exposes long tool activity as a keyboard-scrollable region before technical information',()=>{
    const tools=Array.from({length:20},(_,index)=>({id:`tool-${index}`,name:'mcpToolCall',detail:`Call ${index}`,status:'completed' as const}));
    const html=renderToStaticMarkup(<RunDrawer run={{...run,tools}} persona={persona} close={vi.fn()}/>);
    expect(html).toContain('aria-label="Tool activity"');
    expect(html).toContain('tabindex="0"');
    expect(html.indexOf('Tool activity')).toBeLessThan(html.indexOf('Technical information'));
  });
});
