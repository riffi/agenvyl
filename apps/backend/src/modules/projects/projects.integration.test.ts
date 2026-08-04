import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {buildApp} from '../../app/buildApp.js';
import {testDatabaseUrl} from '../../testDatabase.js';

const cleanups:string[]=[];
afterEach(async()=>{await Promise.all(cleanups.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

describe('projects API',()=>{
  it('registers folders, assigns one room project, and detaches it on deletion',async()=>{
    const first=await mkdtemp(join(tmpdir(),'agenvyl-project-one-')),second=await mkdtemp(join(tmpdir(),'agenvyl-project-two-'));cleanups.push(first,second);
    const request=vi.fn<typeof fetch>(async(url,init)=>{
      const path=new URL(String(url)).pathname;
      if(path==='/v2/directories/validate'){
        const input=JSON.parse(String(init?.body)) as{path:string};
        return Response.json({apiVersion:'v2',status:'available',path:input.path,pathKey:input.path.toLocaleLowerCase('en-US')});
      }
      if(path==='/v2/directories/pick')return Response.json({apiVersion:'v2',status:'selected',path:first});
      return new Response('{}',{status:404});
    });
    const app=await buildApp({databaseUrl:testDatabaseUrl('projects_api'),connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32),fetch:request,distPath:'missing-dist',legacySeed:false,logger:false});
    const created=await app.inject({method:'POST',url:'/api/v1/projects',payload:{name:'Main project',path:first}});expect(created.statusCode).toBe(201);expect(created.json()).toMatchObject({name:'Main project',path:first,availability:'available'});
    expect((await app.inject({method:'POST',url:'/api/v1/projects',payload:{name:'main PROJECT',path:second}})).statusCode).toBe(409);
    const projectId=created.json().id as string,room=await app.inject({method:'POST',url:'/api/v1/rooms',payload:{title:'Project room',persona_ids:[],project_id:projectId}});expect(room.statusCode).toBe(201);expect(room.json().project).toMatchObject({id:projectId,name:'Main project'});
    expect((await app.inject({method:'PUT',url:`/api/v1/rooms/${room.json().id}/project`,payload:{project_id:null}})).json().project).toBeNull();
    await app.inject({method:'PUT',url:`/api/v1/rooms/${room.json().id}/project`,payload:{project_id:projectId}});
    expect((await app.inject({method:'POST',url:'/api/v1/projects/pick-directory'})).json()).toEqual({status:'selected',path:first});
    expect((await app.inject({method:'DELETE',url:`/api/v1/projects/${projectId}`})).statusCode).toBe(204);
    expect((await app.inject('/api/v1/rooms')).json()[0].project).toBeNull();
    await app.close();
  });

  it('rejects unavailable paths without storing them',async()=>{
    const request=vi.fn<typeof fetch>(async()=>Response.json({apiVersion:'v2',status:'unavailable',error:{code:'directory_not_found',message:'Missing folder'}}));
    const app=await buildApp({databaseUrl:testDatabaseUrl('projects_missing'),connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32),fetch:request,distPath:'missing-dist',legacySeed:false,logger:false});
    const response=await app.inject({method:'POST',url:'/api/v1/projects',payload:{name:'Missing',path:'C:\\missing'}});
    expect(response.statusCode).toBe(400);expect(response.json()).toMatchObject({error:'directory_not_found'});expect((await app.inject('/api/v1/projects')).json()).toEqual([]);
    await app.close();
  });
});
