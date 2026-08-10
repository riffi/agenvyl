import {afterEach,describe,expect,it,vi} from 'vitest';
import {buildPreviewApp} from './buildPreviewApp.js';

describe('preview origin app',()=>{
  const apps:Array<Awaited<ReturnType<typeof buildPreviewApp>>>=[];
  afterEach(async()=>Promise.all(apps.splice(0).map(app=>app.close())));

  it('relays only preview resources and preserves isolation headers',async()=>{
    const request=vi.fn<typeof fetch>(async input=>{
      expect(String(input)).toBe('http://127.0.0.1:8791/api/v1/rooms/room/workspace/versions/version/preview/app.js');
      return new Response('localStorage.setItem("ready","yes")',{headers:{
        'content-type':'text/javascript',
        'content-security-policy':"default-src 'self' https:",
        'x-content-type-options':'nosniff',
        'cache-control':'public, max-age=31536000, immutable',
        etag:'"hash"',
      }});
    });
    const app=await buildPreviewApp({upstreamOrigin:'http://127.0.0.1:8791',fetch:request,logger:false});
    apps.push(app);

    const response=await app.inject('/api/v1/rooms/room/workspace/versions/version/preview/app.js');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('localStorage');
    expect(response.headers['content-security-policy']).toBe("default-src 'self' https:");
    expect(response.headers.etag).toBe('"hash"');
    expect(response.headers['cache-control']).toContain('immutable');
    expect((await app.inject('/api/v1/rooms/room/workspace')).statusCode).toBe(404);
  });

  it('relays run preview resources',async()=>{
    const request=vi.fn<typeof fetch>(async input=>{
      expect(String(input)).toBe('http://127.0.0.1:8791/api/v1/rooms/room/runs/run/preview/assets/app.js');
      return new Response('ready',{headers:{'content-type':'text/javascript'}});
    });
    const app=await buildPreviewApp({upstreamOrigin:'http://127.0.0.1:8791',fetch:request,logger:false});
    apps.push(app);

    const response=await app.inject('/api/v1/rooms/room/runs/run/preview/assets/app.js');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('ready');
  });

  it('scopes absolute Vite assets from a same-origin run preview referrer',async()=>{
    const request=vi.fn<typeof fetch>();
    const app=await buildPreviewApp({upstreamOrigin:'http://127.0.0.1:8791',fetch:request,logger:false});
    apps.push(app);
    const headers={host:'preview.test',referer:'http://preview.test/api/v1/rooms/room/runs/run/preview/'};

    const asset=await app.inject({method:'GET',url:'/assets/app.js?v=1',headers});
    expect(asset.statusCode).toBe(302);
    expect(asset.headers.location).toBe('/api/v1/rooms/room/runs/run/preview/assets/app.js?v=1');
    expect(request).not.toHaveBeenCalled();
    expect((await app.inject({method:'GET',url:'/assets/app.js',headers:{...headers,referer:'http://other.test/api/v1/rooms/room/runs/run/preview/'}})).statusCode).toBe(404);
    expect((await app.inject({method:'GET',url:'/assets/..%2Fsecret',headers})).statusCode).toBe(404);
    expect((await app.inject({method:'GET',url:'/assets/app.js',headers:{host:'preview.test'}})).statusCode).toBe(404);
  });
});
