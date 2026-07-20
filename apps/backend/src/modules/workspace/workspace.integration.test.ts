import {mkdtemp,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {buildApp as buildAppBase,type AppOptions} from '../../app/buildApp.js';
import {testDatabaseUrl} from '../../testDatabase.js';

const buildApp=(options:AppOptions={})=>buildAppBase({connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32),...options});

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});

describe('versioned room workspace',()=>{
  it('keeps message attachments immutable when the live file is replaced',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'workspace-api-'));roots.push(root);
    const app=await buildApp({databaseUrl:testDatabaseUrl('workspace_attachment'),workspaceRoot:root,workspaceAgentRoot:root,fetch:vi.fn<typeof fetch>(),distPath:'missing-dist'});
    const first=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/markdown','x-file-path':encodeURIComponent('notes/spec.md')},payload:Buffer.from('# first')});
    expect(first.statusCode).toBe(201);const original=first.json();
    const message=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/messages',payload:{text:'review this',attachment_version_ids:[original.version.id]}});
    expect(message.statusCode).toBe(202);expect(message.json().attachments[0]).toMatchObject({version_id:original.version.id,path:'notes/spec.md'});
    const replaced=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/markdown','x-file-path':encodeURIComponent('notes/spec.md'),'x-conflict-strategy':'replace'},payload:Buffer.from('# second')});
    expect(replaced.statusCode).toBe(201);expect(replaced.json().version.id).not.toBe(original.version.id);
    const old=await app.inject(`/api/v1/rooms/demo-room/workspace/versions/${original.version.id}/preview`),latest=await app.inject(`/api/v1/rooms/demo-room/workspace/versions/${replaced.json().version.id}/preview`);
    expect(old.body).toBe('# first');expect(latest.body).toBe('# second');
    const timeline=await app.inject('/api/v1/rooms/demo-room/timeline');expect(timeline.json().messages.at(-1).attachments[0].version_id).toBe(original.version.id);
    await app.close();
  });

  it('accepts an attachment-only message and still rejects an empty message',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'workspace-api-'));roots.push(root);
    const app=await buildApp({databaseUrl:testDatabaseUrl('workspace_attachment_only'),workspaceRoot:root,workspaceAgentRoot:root,fetch:vi.fn<typeof fetch>(),distPath:'missing-dist'});
    const uploaded=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'image/png','x-file-path':encodeURIComponent('Inbox/image.png')},payload:Buffer.from('image')});
    const attachmentOnly=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/messages',payload:{attachment_version_ids:[uploaded.json().version.id]}});
    expect(attachmentOnly.statusCode).toBe(202);expect(attachmentOnly.json()).toMatchObject({text:'',runIds:[]});expect(attachmentOnly.json().attachments).toHaveLength(1);
    const empty=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/messages',payload:{text:'  '}});expect(empty.statusCode).toBe(400);expect(empty.json().error).toBe('text_required');
    await app.close();
  });

  it('sandboxes HTML preview and rejects traversal',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'workspace-api-'));roots.push(root);
    const app=await buildApp({databaseUrl:testDatabaseUrl('workspace_preview'),workspaceRoot:root,workspaceAgentRoot:root,fetch:vi.fn<typeof fetch>(),distPath:'missing-dist'});
    const invalid=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/plain','x-file-path':encodeURIComponent('../secret.txt')},payload:Buffer.from('secret')});expect(invalid.statusCode).toBe(400);
    const uploaded=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/html','x-file-path':'demo.html'},payload:Buffer.from('<html><head></head><body><script>fetch("https://example.com")</script></body></html>')});
    const preview=await app.inject(`/api/v1/rooms/demo-room/workspace/versions/${uploaded.json().version.id}/preview`);expect(preview.headers['content-security-policy']).toContain("connect-src 'none'");expect(preview.body).toContain('<base href=');
    await app.close();
  });

  it('keeps trashed room files recoverable and purges them explicitly',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'workspace-api-'));roots.push(root);const app=await buildApp({databaseUrl:testDatabaseUrl('workspace_purge'),workspaceRoot:root,workspaceAgentRoot:root,fetch:vi.fn<typeof fetch>(),distPath:'missing-dist'});
    const room=(await app.inject({method:'POST',url:'/api/v1/rooms',payload:{title:'Temporary workspace'}})).json();await app.inject({method:'POST',url:`/api/v1/rooms/${room.id}/workspace/files`,headers:{'content-type':'text/plain','x-file-path':'result.txt'},payload:Buffer.from('result')});
    await app.inject({method:'DELETE',url:`/api/v1/rooms/${room.id}`});expect(await stat(path.join(root,room.id,'result.txt')).then(()=>true)).toBe(true);expect((await app.inject('/api/v1/rooms?deleted=true')).json().some((value:{id:string})=>value.id===room.id)).toBe(true);
    expect((await app.inject({method:'DELETE',url:`/api/v1/rooms/${room.id}?permanent=true`})).statusCode).toBe(204);expect(await stat(path.join(root,room.id)).then(()=>true).catch(()=>false)).toBe(false);await app.close();
  });
});
