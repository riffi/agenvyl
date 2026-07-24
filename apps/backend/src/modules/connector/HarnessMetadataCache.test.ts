import {describe,expect,it,vi} from 'vitest';
import {HarnessCacheInvalidatedError,HarnessMetadataCache} from './HarnessMetadataCache.js';

describe('HarnessMetadataCache',()=>{
  it('serves fresh values, then returns stale immediately while one refresh runs',async()=>{
    let now=0;
    const next=deferred<string>();
    const load=vi.fn<()=>Promise<string>>().mockResolvedValueOnce('initial').mockImplementationOnce(()=>next.promise);
    const cache=new HarnessMetadataCache<string>({now:()=>now,ttlMs:300_000,retryMs:30_000,error:{code:'failed',message:'Refresh failed'}});

    await expect(cache.read(load)).resolves.toMatchObject({value:'initial',cache:{state:'fresh'}});
    await expect(cache.read(load)).resolves.toMatchObject({value:'initial',cache:{state:'fresh'}});
    expect(load).toHaveBeenCalledTimes(1);

    now=300_001;
    await expect(cache.read(load)).resolves.toMatchObject({value:'initial',cache:{state:'refreshing'}});
    const forced=cache.read(load,true);
    expect(load).toHaveBeenCalledTimes(2);
    next.resolve('updated');
    await expect(forced).resolves.toMatchObject({value:'updated',cache:{state:'fresh'}});
  });

  it('uses stale data with a retry cooldown and fails closed without a value',async()=>{
    let now=0;
    const load=vi.fn<()=>Promise<string>>().mockResolvedValueOnce('initial').mockRejectedValue(new Error('offline'));
    const cache=new HarnessMetadataCache<string>({now:()=>now,ttlMs:10,retryMs:30,error:{code:'failed',message:'Refresh failed'}});
    await cache.read(load);
    now=11;
    await expect(cache.read(load)).resolves.toMatchObject({cache:{state:'refreshing'}});
    await vi.waitFor(()=>expect(load).toHaveBeenCalledTimes(2));
    await expect(cache.read(load)).resolves.toMatchObject({value:'initial',cache:{state:'stale',error:{code:'failed'}}});
    expect(load).toHaveBeenCalledTimes(2);
    now=41;
    await expect(cache.read(load)).resolves.toMatchObject({cache:{state:'refreshing'}});
    await vi.waitFor(()=>expect(load).toHaveBeenCalledTimes(3));

    const cold=new HarnessMetadataCache<string>({error:{code:'failed',message:'Refresh failed'}});
    await expect(cold.read(async()=>{throw new Error('offline');})).rejects.toThrow('offline');
  });

  it('prevents an invalidated in-flight value from repopulating the cache',async()=>{
    const pending=deferred<string>();
    const cache=new HarnessMetadataCache<string>({error:{code:'failed',message:'Refresh failed'}});
    const old=cache.read(()=>pending.promise);
    cache.invalidate();
    pending.resolve('old');
    await expect(old).rejects.toBeInstanceOf(HarnessCacheInvalidatedError);
    await expect(cache.read(async()=>'new')).resolves.toMatchObject({value:'new',cache:{state:'fresh'}});
    expect(cache.current()).toBe('new');
  });
});

const deferred=<T>()=>{
  let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;
  const promise=new Promise<T>((accept,decline)=>{resolve=accept;reject=decline;});
  return{promise,resolve,reject};
};
