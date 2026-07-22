import {describe,expect,it} from 'vitest';
import {selectStarterAgentRoutes,type StarterAgentRoute,type StarterHarnessCatalog} from './starterAgentRoutes.js';

const preferred:StarterAgentRoute={harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'open-model',permission_profile_id:null,agent_variant_id:'build'};
const source=(id:string,type:string,models:Array<{id:string}>,permissions:string[]=[],variants:string[]=[]):StarterHarnessCatalog=>({id,type,catalog:{apiVersion:'v2',connectorEpoch:'epoch',instanceId:id,models,controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:permissions.map(item=>({id:item})),agentVariants:variants.map(item=>({id:item}))}}});

describe('starter agent route selection',()=>{
  it('prefers different harness types before different models',()=>{
    const routes=selectStarterAgentRoutes(preferred,[
      source('local-opencode','opencode',[{id:'open-model'},{id:'other-open-model'}],[],['build']),
      source('local-codex','codex',[{id:'codex-model'}],['workspace-write']),
      source('local-claude','claude',[{id:'claude-model'}],['default']),
    ],3);
    expect(routes).toEqual([
      preferred,
      {harness_instance_id:'local-codex',harness_type:'codex',model_id:'codex-model',permission_profile_id:'workspace-write',agent_variant_id:null},
      {harness_instance_id:'local-claude',harness_type:'claude',model_id:'claude-model',permission_profile_id:'default',agent_variant_id:null},
    ]);
  });

  it('uses different models and finally repeats a route when choices run out',()=>{
    const routes=selectStarterAgentRoutes(preferred,[source('local-opencode','opencode',[{id:'open-model'},{id:'other-open-model'}],[],['build'])],3);
    expect(routes.map(route=>route.model_id)).toEqual(['open-model','other-open-model','open-model']);
  });
});
