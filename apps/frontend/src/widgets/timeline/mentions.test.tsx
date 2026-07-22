import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import type {Persona} from '../../entities/persona';
import type {Run} from '../../entities/run';
import {MarkdownAnswer} from './Timeline';
import {MentionText} from './mentions';

const personas:Persona[]=[
  {id:'foreign-id',handle:'foreign',name:'Мимокрокодил',role:'Наблюдатель',color:'#0f766e',requested_model:'qwen',harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'qwen',permission_profile_id:null,agent_variant_id:null,group_id:null,archived_at:null},
];
const run:Run={id:'run',messageId:'message',agent:'foreign',harnessInstanceId:'local-hermes',harnessType:'hermes',modelId:'qwen',executionProfile:{workflowMode:'work',requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,planEnforcement:null,permissionProfileId:null,agentVariantId:null,implementationPlanVersionId:null},status:'completed',text:'',tools:[]};

describe('timeline persona mentions',()=>{
  it('shows known handles as persona names and keeps unknown and bare handles intact',()=>{
    const html=renderToStaticMarkup(<MentionText text="@FOREIGN, foreign и @missing" personas={personas}/>);
    expect(html).toContain('Мимокрокодил');
    expect(html).toContain('title="Add @foreign to the message · Наблюдатель"');
    expect(html).toContain('foreign и @missing');
  });

  it('renders @all as a neutral label and ignores email fragments',()=>{
    const html=renderToStaticMarkup(<MentionText text="@all · a@foreign.dev" personas={personas}/>);
    expect(html).toContain('All participants');
    expect(html).toContain('a@foreign.dev');
  });

  it('transforms markdown text but not code or existing links',()=>{
    const html=renderToStaticMarkup(<MarkdownAnswer text={'Привет, @foreign. `@foreign` [@foreign](https://example.com)'} run={run} personas={personas}/>);
    expect(html.match(/>Мимокрокодил<\/button>/g)).toHaveLength(1);
    expect(html).toContain('<code>@foreign</code>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('>@foreign</a>');
  });
});
