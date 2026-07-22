import {describe,expect,it} from 'vitest';
import {selectStarterAgentRoutes,type StarterAgentRoute,type StarterHarnessCatalog} from './starterAgentRoutes.js';

const preferred:StarterAgentRoute={harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'open-model',mode_id:'build'};
const source=(id:string,type:string,models:Array<{id:string;supportedModeIds?:string[]}>,modes:string[]):StarterHarnessCatalog=>({id,type,catalog:{apiVersion:'v1',connectorEpoch:'epoch',instanceId:id,models,modes:modes.map(mode=>({id:mode}))}});

describe('starter agent route selection',()=>{
  it('prefers different harness types before different models',()=>{
    const routes=selectStarterAgentRoutes(preferred,[
      source('local-opencode','opencode',[{id:'open-model'},{id:'other-open-model'}],['build']),
      source('local-codex','codex',[{id:'codex-model',supportedModeIds:['workspace-write/default']}],['workspace-write/default']),
      source('local-claude','claude',[{id:'claude-model',supportedModeIds:['plan/high','default/high']}],['plan/high','default/high']),
    ],3);
    expect(routes).toEqual([
      preferred,
      {harness_instance_id:'local-codex',harness_type:'codex',model_id:'codex-model',mode_id:'workspace-write/default'},
      {harness_instance_id:'local-claude',harness_type:'claude',model_id:'claude-model',mode_id:'default/high'},
    ]);
  });

  it('uses different models and finally repeats a route when choices run out',()=>{
    const routes=selectStarterAgentRoutes(preferred,[source('local-opencode','opencode',[{id:'open-model'},{id:'other-open-model'}],['build'])],3);
    expect(routes.map(route=>route.model_id)).toEqual(['open-model','other-open-model','open-model']);
  });
});
