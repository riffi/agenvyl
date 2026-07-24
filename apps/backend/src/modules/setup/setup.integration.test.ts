import {describe,expect,it,vi} from 'vitest';
import {buildApp} from '../../app/buildApp.js';
import {connectTestDatabase,testDatabaseUrl} from '../../testDatabase.js';

describe('setup API',()=>{
  it('reports unavailable Connector settings as a service outage',async()=>{
    const app=await buildApp({databaseUrl:testDatabaseUrl('setup_connector_unavailable'),connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32),fetch:vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),distPath:'missing-dist',legacySeed:false,logger:false});
    const response=await app.inject('/api/v1/harness-settings');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({error:'connector_unavailable',message:'Connector settings are unavailable'});
    await app.close();
  });

  it('bootstraps a fresh zero-harness installation atomically and idempotently',async()=>{
    const request=vi.fn<typeof fetch>(async url=>{const path=new URL(String(url)).pathname;if(path==='/v2/discovery')return Response.json({apiVersion:'v2',candidates:[]});if(path==='/v2/instances')return Response.json({apiVersion:'v2',connectorEpoch:'epoch',instances:[]});if(path==='/v2/configuration')return Response.json({apiVersion:'v2',instances:[]});return new Response('{}',{status:404});});
    const databaseUrl=testDatabaseUrl('setup_api'),app=await buildApp({databaseUrl,connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32),fetch:request,distPath:'missing-dist',legacySeed:false,logger:false});
    const setup=(await app.inject('/api/v1/setup')).json();expect(setup).toMatchObject({completed:false,instances:[],candidates:[],workspaceRoot:expect.any(String)});
    expect((await app.inject({method:'PUT',url:'/api/v1/setup/harnesses',payload:{instances:[{id:'local-antigravity',type:'antigravity',enabled:true}]}})).statusCode).toBe(400);
    const payload={locale:'ru',workspace_root:setup.workspaceRoot,profile:{display_name:'Владимир',handle:'vladimir'},room_title:'Первая комната',route:null};
    const first=await app.inject({method:'POST',url:'/api/v1/setup/complete',payload});expect(first.statusCode).toBe(200);
    const repeated=await app.inject({method:'POST',url:'/api/v1/setup/complete',payload});expect(repeated.json()).toEqual(first.json());
    const sql=connectTestDatabase(databaseUrl);expect((await sql`SELECT COUNT(*)::int count FROM rooms`)[0]).toEqual({count:1});expect((await sql`SELECT COUNT(*)::int count FROM personas`)[0]).toEqual({count:0});expect((await sql`SELECT display_name,handle FROM local_user_profiles WHERE id='local-user'`)[0]).toEqual({display_name:'Владимир',handle:'vladimir'});await sql.end();await app.close();
  });
  it('creates Architect, Builder, and Reviewer on different harnesses when available',async()=>{
    const instances=[
      {id:'local-opencode',type:'opencode',status:'healthy',capabilities:['model_catalog'],managed:true},
      {id:'local-codex',type:'codex',status:'healthy',capabilities:['model_catalog']},
      {id:'local-claude',type:'claude',status:'healthy',capabilities:['model_catalog']},
    ];
    const configured=instances.map(instance=>({id:instance.id,type:instance.type,enabled:true,...(instance.managed?{managed:true}:{})}));
    const catalogs:Record<string,{models:Array<{id:string;reasoningEfforts?:string[];defaultReasoningEffort?:string}>;controls:{nativeWorkflowModes:Array<'plan'|'work'>;permissionProfiles:Array<{id:string}>;agentVariants:Array<{id:string}>}}>={
      'local-opencode':{models:[{id:'open-model'}],controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[],agentVariants:[{id:'build'}]}},
      'local-codex':{models:[{id:'codex-model',reasoningEfforts:['default'],defaultReasoningEffort:'default'}],controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[{id:'workspace-write'}],agentVariants:[]}},
      'local-claude':{models:[{id:'claude-model',reasoningEfforts:['high'],defaultReasoningEffort:'high'}],controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[{id:'default'}],agentVariants:[]}},
    };
    const request=vi.fn<typeof fetch>(async url=>{
      const path=new URL(String(url)).pathname;
      if(path==='/v2/instances')return Response.json({apiVersion:'v2',connectorEpoch:'epoch',instances});
      if(path==='/v2/configuration')return Response.json({apiVersion:'v2',instances:configured});
      if(path==='/v2/discovery')return Response.json({apiVersion:'v2',candidates:[]});
      const instanceId=path.match(/^\/v2\/instances\/([^/]+)\/catalog$/)?.[1],catalog=instanceId?catalogs[instanceId]:undefined;
      if(catalog)return Response.json({apiVersion:'v2',connectorEpoch:'epoch',instanceId,...catalog});
      return new Response('{}',{status:404});
    });
    const databaseUrl=testDatabaseUrl('setup_route'),app=await buildApp({databaseUrl,connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32),fetch:request,distPath:'missing-dist',legacySeed:false,logger:false}),setup=(await app.inject('/api/v1/setup')).json();
    expect(setup.instances).toHaveLength(3);
    const response=await app.inject({method:'POST',url:'/api/v1/setup/complete',payload:{locale:'en',workspace_root:setup.workspaceRoot,profile:{display_name:'User',handle:'user'},room_title:'First room',route:{harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'open-model',permission_profile_id:null,agent_variant_id:'build'}}});expect(response.statusCode).toBe(200);
    const settings=(await app.inject('/api/v1/harness-settings')).json();expect(settings.instances.map((instance:{id:string;personas:Array<{handle:string}>})=>({id:instance.id,handles:instance.personas.map(persona=>persona.handle)}))).toEqual([
      {id:'local-opencode',handles:['architect']},
      {id:'local-codex',handles:['builder']},
      {id:'local-claude',handles:['reviewer']},
    ]);
    const removal=await app.inject({method:'PUT',url:'/api/v1/harness-settings',payload:{instances:[]}});expect(removal.statusCode).toBe(409);expect(removal.json()).toMatchObject({error:'harness_instance_in_use'});
    const sql=connectTestDatabase(databaseUrl);expect((await sql`SELECT handle,harness_instance_id,model_id,permission_profile_id,agent_variant_id FROM personas ORDER BY handle`).map(row=>row)).toEqual([
      {handle:'architect',harness_instance_id:'local-opencode',model_id:'open-model',permission_profile_id:null,agent_variant_id:'build'},
      {handle:'builder',harness_instance_id:'local-codex',model_id:'codex-model',permission_profile_id:'workspace-write',agent_variant_id:null},
      {handle:'reviewer',harness_instance_id:'local-claude',model_id:'claude-model',permission_profile_id:'default',agent_variant_id:null},
    ]);await sql.end();await app.close();
  });
});
