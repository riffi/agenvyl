import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {buildApp} from '../../app/buildApp.js';
import {buildConnectorApp} from '../../../../connector/src/app.js';
import {testDatabaseUrl} from '../../testDatabase.js';

describe('project files end to end',()=>{
  it('serves current project files, persists overrides and snapshots attachments without changing the project',async()=>{
    const root=await mkdtemp(join(tmpdir(),'agenvyl-project-api-')),project=join(root,'project'),workspace=join(root,'workspace');
    await mkdir(join(project,'dist'),{recursive:true});await mkdir(workspace);
    await writeFile(join(project,'dist/index.html'),'<head></head><p>current</p>');await writeFile(join(project,'dist/other.html'),'<p>other</p>');await writeFile(join(project,'note.txt'),'original');
    const token='x'.repeat(32),connector=buildConnectorApp({version:1,token,listen:{host:'127.0.0.1',port:4310},instances:[],workspaces:{roots:[]}});
    const request:typeof fetch=async(url,init)=>{
      const result=await connector.inject({method:(init?.method??'GET') as 'GET'|'POST',url:new URL(String(url)).pathname,headers:init?.headers as Record<string,string>,payload:init?.body as string|undefined});
      return new Response(result.body,{status:result.statusCode,headers:{'content-type':'application/json'}});
    };
    const app=await buildApp({databaseUrl:testDatabaseUrl('project_files_api'),connectorUrl:'http://connector.test',connectorToken:token,fetch:request,workspaceRoot:workspace,distPath:'missing',legacySeed:false,logger:false});
    try{
      const created=await app.inject({method:'POST',url:'/api/v1/projects',payload:{name:'Preview test',path:project}});expect(created.statusCode).toBe(201);
      const id=created.json().id,base=`/api/v1/projects/${id}`;
      const room=(await app.inject({method:'POST',url:'/api/v1/rooms',payload:{title:'Preview',persona_ids:[],project_id:id}})).json();
      expect((await app.inject(`${base}/inspection`)).json()).toMatchObject({entrypoint:'dist/index.html',settings:{entrypoint:null,build_command:null}});
      expect((await app.inject(`${base}/files`)).json().entries.map((item:{name:string})=>item.name)).toEqual(['dist','note.txt']);
      const url=`${base}/preview/${Buffer.from('dist/index.html').toString('base64url')}/`;
      const preview=await app.inject(url);expect(preview.statusCode).toBe(200);expect(preview.body).toContain('<base href=');expect(preview.headers['cache-control']).toBe('no-store');
      await writeFile(join(project,'dist/index.html'),'<p>updated</p>');expect((await app.inject(url)).body).toContain('updated');
      const saved=await app.inject({method:'PUT',url:`${base}/preview-settings`,payload:{entrypoint:'dist/other.html',build_command:'echo manual'}});expect(saved.statusCode).toBe(200);
      expect((await app.inject(`${base}/inspection`)).json()).toMatchObject({entrypoint:'dist/other.html',build_command:'echo manual'});
      expect((await app.inject({method:'PUT',url:`${base}/preview-settings`,payload:{entrypoint:'../outside.html',build_command:null}})).statusCode).toBe(400);
      const captured=await app.inject({method:'POST',url:`${base}/attach`,payload:{roomId:room.id,path:'note.txt'}});expect(captured.statusCode).toBe(200);
      await writeFile(join(project,'note.txt'),'changed');
      expect((await app.inject(captured.json().url)).body).toBe('original');
      await writeFile(join(project,'empty%20.txt'),'');
      const empty=await app.inject({method:'POST',url:`${base}/attach`,payload:{roomId:room.id,path:'empty%20.txt'}});
      expect(empty.statusCode).toBe(200);expect(empty.json().name).toBe('empty%20.txt');expect((await app.inject(empty.json().url)).body).toBe('');
      expect(await readFile(join(project,'note.txt'),'utf8')).toBe('changed');
      expect((await app.inject(`${base}/file?path=note.txt`)).body).toBe('changed');
      expect((await app.inject(`${base}/file?path=../secret`)).statusCode).toBe(400);
      await app.inject({method:'PUT',url:`/api/v1/rooms/${room.id}/project`,payload:{project_id:null}});
      expect((await app.inject({method:'POST',url:`${base}/attach`,payload:{roomId:room.id,path:'note.txt'}})).statusCode).toBe(409);
    }finally{await app.close();await connector.close();await rm(root,{recursive:true,force:true});}
  },30000);
});
