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
      }});
    });
    const app=await buildPreviewApp({upstreamOrigin:'http://127.0.0.1:8791',fetch:request,logger:false});
    apps.push(app);

    const response=await app.inject('/api/v1/rooms/room/workspace/versions/version/preview/app.js');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('localStorage');
    expect(response.headers['content-security-policy']).toBe("default-src 'self' https:");
    expect((await app.inject('/api/v1/rooms/room/workspace')).statusCode).toBe(404);
  });
});
