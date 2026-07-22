import {describe,expect,it,vi} from 'vitest';
import {buildApp} from '../../app/buildApp.js';
import {connectTestDatabase,testDatabaseUrl} from '../../testDatabase.js';

describe('setup API',()=>{
  it('bootstraps a fresh zero-harness installation atomically and idempotently',async()=>{
    const request=vi.fn<typeof fetch>(async url=>{const path=new URL(String(url)).pathname;if(path==='/v1/discovery')return Response.json({apiVersion:'v1',candidates:[]});if(path==='/v1/instances')return Response.json({apiVersion:'v1',connectorEpoch:'epoch',instances:[]});return new Response('{}',{status:404});});
    const databaseUrl=testDatabaseUrl('setup_api'),app=await buildApp({databaseUrl,connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32),fetch:request,distPath:'missing-dist',legacySeed:false,logger:false});
    const setup=(await app.inject('/api/v1/setup')).json();expect(setup).toMatchObject({completed:false,instances:[],candidates:[],workspaceRoot:expect.any(String)});
    expect((await app.inject({method:'PUT',url:'/api/v1/setup/harnesses',payload:{instances:[{id:'local-antigravity',type:'antigravity',enabled:true}]}})).statusCode).toBe(400);
    const payload={locale:'ru',workspace_root:setup.workspaceRoot,profile:{display_name:'Владимир',handle:'vladimir'},room_title:'Первая комната',route:null};
    const first=await app.inject({method:'POST',url:'/api/v1/setup/complete',payload});expect(first.statusCode).toBe(200);
    const repeated=await app.inject({method:'POST',url:'/api/v1/setup/complete',payload});expect(repeated.json()).toEqual(first.json());
    const sql=connectTestDatabase(databaseUrl);expect((await sql`SELECT COUNT(*)::int count FROM rooms`)[0]).toEqual({count:1});expect((await sql`SELECT COUNT(*)::int count FROM personas`)[0]).toEqual({count:0});expect((await sql`SELECT display_name,handle FROM local_user_profiles WHERE id='local-user'`)[0]).toEqual({display_name:'Владимир',handle:'vladimir'});await sql.end();await app.close();
  });
  it('creates Architect, Builder, and Reviewer against a verified route',async()=>{
    const request=vi.fn<typeof fetch>(async url=>{const path=new URL(String(url)).pathname;if(path==='/v1/instances')return Response.json({apiVersion:'v1',connectorEpoch:'epoch',instances:[{id:'local-opencode',type:'opencode',status:'healthy',capabilities:['model_catalog'],managed:true}]});if(path==='/v1/configuration')return Response.json({apiVersion:'v1',instances:[{id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true}]});if(path==='/v1/instances/local-opencode/catalog')return Response.json({apiVersion:'v1',connectorEpoch:'epoch',instanceId:'local-opencode',models:[{id:'model-1'}],modes:[]});if(path==='/v1/discovery')return Response.json({apiVersion:'v1',candidates:[]});return new Response('{}',{status:404});});
    const databaseUrl=testDatabaseUrl('setup_route'),app=await buildApp({databaseUrl,connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32),fetch:request,distPath:'missing-dist',legacySeed:false,logger:false}),setup=(await app.inject('/api/v1/setup')).json();
    expect(setup.instances).toEqual([{id:'local-opencode',type:'opencode',status:'healthy',managed:true}]);
    const response=await app.inject({method:'POST',url:'/api/v1/setup/complete',payload:{locale:'en',workspace_root:setup.workspaceRoot,profile:{display_name:'User',handle:'user'},room_title:'First room',route:{harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'model-1',mode_id:null}}});expect(response.statusCode).toBe(200);
    const settings=(await app.inject('/api/v1/harness-settings')).json();expect(settings.instances[0]).toMatchObject({id:'local-opencode',enabled:true,status:'healthy',personas:[{handle:'architect'},{handle:'builder'},{handle:'reviewer'}]});
    const removal=await app.inject({method:'PUT',url:'/api/v1/harness-settings',payload:{instances:[]}});expect(removal.statusCode).toBe(409);expect(removal.json()).toMatchObject({error:'harness_instance_in_use'});
    const sql=connectTestDatabase(databaseUrl);expect((await sql`SELECT handle,harness_instance_id,model_id FROM personas ORDER BY handle`).map(row=>row)).toEqual([{handle:'architect',harness_instance_id:'local-opencode',model_id:'model-1'},{handle:'builder',harness_instance_id:'local-opencode',model_id:'model-1'},{handle:'reviewer',harness_instance_id:'local-opencode',model_id:'model-1'}]);await sql.end();await app.close();
  });
});
