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

  it('allows external HTML resources while preserving the iframe sandbox boundary',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'workspace-api-'));roots.push(root);
    const app=await buildApp({databaseUrl:testDatabaseUrl('workspace_preview'),workspaceRoot:root,workspaceAgentRoot:root,fetch:vi.fn<typeof fetch>(),distPath:'missing-dist'});
    const invalid=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/plain','x-file-path':encodeURIComponent('../secret.txt')},payload:Buffer.from('secret')});expect(invalid.statusCode).toBe(400);
    const reserved=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/plain','x-file-path':'.agenvyl/secret.txt'},payload:Buffer.from('secret')});expect(reserved.statusCode).toBe(400);expect(reserved.json().error).toBe('workspace_reserved_path');
    const uploaded=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/html','x-file-path':'demo.html'},payload:Buffer.from('<html><head></head><body><script>fetch("https://example.com")</script></body></html>')});
    const preview=await app.inject(`/api/v1/rooms/demo-room/workspace/versions/${uploaded.json().version.id}/preview`),csp=preview.headers['content-security-policy'];
    expect(csp).toContain("style-src 'self' http: https: 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' http: https: ws: wss:");
    expect(csp).toContain("font-src 'self' http: https: data:");
    expect(csp).not.toContain("connect-src 'none'");
    expect(preview.body).toContain('<base href=');
    await app.close();
  });

  it('keeps version history attached to a file after it is moved',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'workspace-api-'));roots.push(root);
    const app=await buildApp({databaseUrl:testDatabaseUrl('workspace_version_move'),workspaceRoot:root,workspaceAgentRoot:root,fetch:vi.fn<typeof fetch>(),distPath:'missing-dist'});
    const first=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/plain','x-file-path':'notes.txt'},payload:Buffer.from('first')});
    const second=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/plain','x-file-path':'notes.txt','x-conflict-strategy':'replace'},payload:Buffer.from('second')});
    const entry=second.json().entry;
    expect((await app.inject({method:'PATCH',url:`/api/v1/rooms/demo-room/workspace/entries/${entry.id}`,payload:{path:'archive/notes.txt'}})).statusCode).toBe(200);
    const versions=await app.inject(`/api/v1/rooms/demo-room/workspace/entries/${entry.id}/versions`);
    expect(versions.statusCode).toBe(200);
    expect(versions.json().map((version:{id:string})=>version.id)).toEqual([second.json().version.id,first.json().version.id]);
    await app.close();
  });

  it('resolves HTML preview assets from the current workspace',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'workspace-api-'));roots.push(root);
    const app=await buildApp({databaseUrl:testDatabaseUrl('workspace_live_preview'),workspaceRoot:root,workspaceAgentRoot:root,fetch:vi.fn<typeof fetch>(),distPath:'missing-dist'});
    const html=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/html','x-file-path':'site/index.html'},payload:Buffer.from('<link rel="stylesheet" href="style.css"><script src="app.js"></script>')});
    await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/css','x-file-path':'site/style.css'},payload:Buffer.from('body{color:red}')});
    await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/javascript','x-file-path':'site/app.js'},payload:Buffer.from('document.body.dataset.version="first"')});
    const base=`/api/v1/rooms/demo-room/workspace/versions/${html.json().version.id}/preview`;
    const firstStyle=await app.inject(`${base}/style.css`),script=await app.inject(`${base}/app.js`);
    expect(firstStyle.statusCode).toBe(200);expect(firstStyle.body).toBe('body{color:red}');
    expect(script.statusCode).toBe(200);expect(script.body).toContain('version="first"');
    await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/css','x-file-path':'site/style.css','x-conflict-strategy':'replace'},payload:Buffer.from('body{color:blue}')});
    const currentStyle=await app.inject(`${base}/style.css`);
    expect(currentStyle.statusCode).toBe(200);expect(currentStyle.body).toBe('body{color:blue}');
    await app.close();
  });

  it('keeps snapshot-scoped HTML resources immutable after later publications',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'workspace-api-'));roots.push(root);
    const app=await buildApp({databaseUrl:testDatabaseUrl('workspace_snapshot_preview'),workspaceRoot:root,workspaceAgentRoot:root,fetch:vi.fn<typeof fetch>(),distPath:'missing-dist'});
    await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/html','x-file-path':'site/index.html'},payload:Buffer.from('<link rel="stylesheet" href="style.css">')});
    await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/css','x-file-path':'site/style.css'},payload:Buffer.from('body{color:red}')});
    const firstWorkspace=(await app.inject('/api/v1/rooms/demo-room/workspace')).json(),firstBase=`/api/v1/rooms/demo-room/workspace/snapshots/${firstWorkspace.current_snapshot_id}/preview/site`;
    expect((await app.inject(`${firstBase}/style.css`)).body).toBe('body{color:red}');
    const html=await app.inject(`${firstBase}/index.html`);expect(html.body).toContain(`<base href="/api/v1/rooms/demo-room/workspace/snapshots/${firstWorkspace.current_snapshot_id}/preview/site/">`);expect(html.headers['cache-control']).toContain('immutable');
    await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/workspace/files',headers:{'content-type':'text/css','x-file-path':'site/style.css','x-conflict-strategy':'replace'},payload:Buffer.from('body{color:blue}')});
    const nextWorkspace=(await app.inject('/api/v1/rooms/demo-room/workspace')).json(),nextBase=`/api/v1/rooms/demo-room/workspace/snapshots/${nextWorkspace.current_snapshot_id}/preview/site`;
    expect(nextWorkspace.current_snapshot_id).not.toBe(firstWorkspace.current_snapshot_id);
    expect((await app.inject(`${firstBase}/style.css`)).body).toBe('body{color:red}');
    expect((await app.inject(`${nextBase}/style.css`)).body).toBe('body{color:blue}');
    expect((await app.inject(`/api/v1/rooms/demo-room/workspace/snapshots/${firstWorkspace.current_snapshot_id}/preview/missing.css`)).statusCode).toBe(404);
    await app.close();
  });

  it('keeps trashed room files recoverable and purges them explicitly',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'workspace-api-'));roots.push(root);const app=await buildApp({databaseUrl:testDatabaseUrl('workspace_purge'),workspaceRoot:root,workspaceAgentRoot:root,fetch:vi.fn<typeof fetch>(),distPath:'missing-dist'});
    const room=(await app.inject({method:'POST',url:'/api/v1/rooms',payload:{title:'Temporary workspace'}})).json();await app.inject({method:'POST',url:`/api/v1/rooms/${room.id}/workspace/files`,headers:{'content-type':'text/plain','x-file-path':'result.txt'},payload:Buffer.from('result')});
    await app.inject({method:'DELETE',url:`/api/v1/rooms/${room.id}`});expect(await stat(path.join(root,room.id,'result.txt')).then(()=>true)).toBe(true);expect((await app.inject('/api/v1/rooms?deleted=true')).json().some((value:{id:string})=>value.id===room.id)).toBe(true);
    expect((await app.inject({method:'DELETE',url:`/api/v1/rooms/${room.id}?permanent=true`})).statusCode).toBe(204);expect(await stat(path.join(root,room.id)).then(()=>true).catch(()=>false)).toBe(false);await app.close();
  });
});
