import {describe,expect,it,vi} from 'vitest';
import {spawn} from 'node:child_process';
import {ManagedHarnessServers,endpointReady} from './managed-servers.js';

describe('managed harness servers',()=>{
  it('reuses a reachable OpenCode endpoint instead of starting a conflicting process',async()=>{
    const request=vi.fn<typeof fetch>(async()=>new Response('',{status:200}));
    const spawnProcess=vi.fn() as unknown as typeof spawn;
    const servers=new ManagedHarnessServers({},request,spawnProcess);

    await servers.apply([{id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true}]);

    expect(request).toHaveBeenCalledWith('http://127.0.0.1:4096/',expect.objectContaining({signal:expect.any(AbortSignal)}));
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('treats server errors and connection failures as unavailable',async()=>{
    await expect(endpointReady('http://127.0.0.1:4096',vi.fn<typeof fetch>(async()=>new Response('',{status:503})))).resolves.toBe(false);
    await expect(endpointReady('http://127.0.0.1:4096',vi.fn<typeof fetch>(async()=>{throw new Error('offline');}))).resolves.toBe(false);
  });
});
