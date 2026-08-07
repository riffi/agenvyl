import Fastify from 'fastify';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {registerErrorHandler} from '../../app/plugins/errorHandler.js';
import type {RoomWorkspaceService} from './RoomWorkspaceService.js';
import {registerWorkspaceRoutes} from './workspace.routes.js';

const roots:string[]=[];
afterEach(async()=>Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true}))));

describe('run workspace routes',()=>{
  it('applies a captured run through the public endpoint',async()=>{
    const result={base_snapshot_id:'base',result_snapshot_id:'result',published_snapshot_id:'published',capture_status:'complete' as const,publish_status:'published' as const,conflict_count:0,errors:[]};
    const applyRunChanges=vi.fn().mockResolvedValue(result),app=Fastify({logger:false});
    await registerErrorHandler(app);
    await registerWorkspaceRoutes(app,{maxFileBytes:1024,applyRunChanges} as unknown as RoomWorkspaceService);

    const response=await app.inject({method:'POST',url:'/api/v1/rooms/room/runs/run/workspace/apply'});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(applyRunChanges).toHaveBeenCalledWith('room','run');
    await app.close();
  });

  it('serves immutable run HTML and assets with a scoped base URL',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'run-preview-route-'));roots.push(root);
    const htmlPath=path.join(root,'index.html'),scriptPath=path.join(root,'app.js');
    await Promise.all([writeFile(htmlPath,'<html><head></head><body></body></html>'),writeFile(scriptPath,'document.body.dataset.ready="yes"')]);
    const resolveRunPreview=vi.fn(async(_roomId:string,_runId:string,asset='')=>{
      const script=Boolean(asset);
      return{path:script?scriptPath:htmlPath,contentType:script?'text/javascript':'text/html',snapshotId:'result',version:{id:script?'script-version':'html-version',room_id:'room',path:script?'dist/assets/app.js':'dist/index.html',size:script?38:39,mime_type:script?'text/javascript':'text/html',sha256:script?'script-hash':'html-hash',source:'agent' as const,run_ids:['run'],created_at:'2026-08-07T00:00:00.000Z',url:'/version',preview_url:'/preview'}};
    }),app=Fastify({logger:false});
    await registerErrorHandler(app);
    await registerWorkspaceRoutes(app,{maxFileBytes:1024,resolveRunPreview} as unknown as RoomWorkspaceService);

    const html=await app.inject('/api/v1/rooms/room/runs/run/preview/');
    expect(html.statusCode).toBe(200);
    expect(html.body).toContain('<base href="/api/v1/rooms/room/runs/run/preview/">');
    expect(html.headers['cache-control']).toContain('immutable');
    expect(html.headers.etag).toBe('"html-hash"');
    const script=await app.inject('/api/v1/rooms/room/runs/run/preview/assets/app.js');
    expect(resolveRunPreview).toHaveBeenLastCalledWith('room','run','assets/app.js');
    expect(script.statusCode).toBe(200);
    expect(script.body).toContain('dataset.ready');
    expect((await app.inject({method:'GET',url:'/api/v1/rooms/room/runs/run/preview/assets/app.js',headers:{'if-none-match':'"script-hash"'}})).statusCode).toBe(304);
    await app.close();
  });
});
