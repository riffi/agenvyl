import Fastify from 'fastify';
import {describe,expect,it,vi} from 'vitest';
import {registerErrorHandler} from '../../app/plugins/errorHandler.js';
import type {RoomWorkspaceService} from './RoomWorkspaceService.js';
import {registerWorkspaceRoutes} from './workspace.routes.js';

describe('run workspace routes',()=>{
  it('serves HTML and assets read directly from an immutable ZIP bundle',async()=>{
    const resolveRunPreview=vi.fn(async(_roomId:string,_runId:string,asset='')=>{
      const script=Boolean(asset),data=Buffer.from(script?'window.previewBundle=true':'<html><head></head><body>bundle</body></html>');
      return{data,contentType:script?'text/javascript':'text/html',version:{id:'preview-id',path:script?'assets/app.js':'index.html',size:data.length,mime_type:script?'text/javascript':'text/html',sha256:script?'bundle-script':'bundle-html',source:'agent' as const,run_ids:['run'],created_at:'2026-08-10T00:00:00.000Z',url:'/preview',preview_url:'/preview'}};
    }),app=Fastify({logger:false});
    await registerErrorHandler(app);
    await registerWorkspaceRoutes(app,{maxFileBytes:1024,resolveRunPreview} as unknown as RoomWorkspaceService);

    const html=await app.inject('/api/v1/rooms/room/runs/run/preview/'),script=await app.inject('/api/v1/rooms/room/runs/run/preview/assets/app.js');
    expect(html.body).toContain('<base href="/api/v1/rooms/room/runs/run/preview/">');
    expect(script.body).toContain('previewBundle=true');
    const csp=String(html.headers['content-security-policy']);
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(script.headers['content-security-policy']).not.toContain("'wasm-unsafe-eval'");
    const cached=await app.inject({url:'/api/v1/rooms/room/runs/run/preview/',headers:{'if-none-match':String(html.headers.etag)}});
    expect(cached.statusCode).toBe(304);
    expect(cached.headers['content-security-policy']).toBe(csp);
    await app.close();
  });
});
