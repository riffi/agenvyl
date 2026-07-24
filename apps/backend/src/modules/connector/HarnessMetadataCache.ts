export const HARNESS_METADATA_TTL_MS=5*60_000;
export const HARNESS_METADATA_RETRY_MS=30_000;

export type HarnessCacheError={code:string;message:string};
export type HarnessCacheMetadata={
  state:'fresh'|'refreshing'|'stale';
  refreshedAt:string|null;
  expiresAt:string|null;
  error?:HarnessCacheError;
};

type CacheEntry<T>={value:T;refreshedAt:number;expiresAt:number};
type CacheRead<T>={value:T;cache:HarnessCacheMetadata};
type Refresh<T>={generation:number;promise:Promise<CacheRead<T>>};

export class HarnessCacheInvalidatedError extends Error{}

export class HarnessMetadataCache<T>{
  private entry?:CacheEntry<T>;
  private refresh?:Refresh<T>;
  private generation=0;
  private retryAfter=0;
  private lastError?:HarnessCacheError;

  constructor(private readonly options:{
    ttlMs?:number;
    retryMs?:number;
    now?:()=>number;
    error:HarnessCacheError;
  }){}

  current(){return this.entry?.value;}

  async read(load:()=>Promise<T>,forceRefresh=false):Promise<CacheRead<T>>{
    const now=this.now();
    if(forceRefresh)return this.refreshValue(load);
    if(!this.entry)return this.refreshValue(load);
    if(now<this.entry.expiresAt)return this.result(this.entry,'fresh');
    if(!this.refresh&&now>=this.retryAfter)void this.refreshValue(load).catch(()=>undefined);
    return this.result(this.entry,this.refresh?'refreshing':'stale');
  }

  invalidate(){
    this.generation+=1;
    this.entry=undefined;
    this.refresh=undefined;
    this.retryAfter=0;
    this.lastError=undefined;
  }

  private refreshValue(load:()=>Promise<T>){
    const active=this.refresh;
    if(active&&active.generation===this.generation)return active.promise;
    const generation=this.generation;
    const promise=load()
      .then(value=>{
        if(generation!==this.generation)throw new HarnessCacheInvalidatedError('Harness metadata cache was invalidated during refresh');
        const refreshedAt=this.now();
        this.entry={value,refreshedAt,expiresAt:refreshedAt+(this.options.ttlMs??HARNESS_METADATA_TTL_MS)};
        this.retryAfter=0;
        this.lastError=undefined;
        return this.result(this.entry,'fresh');
      })
      .catch((error:unknown)=>{
        if(generation!==this.generation)throw error;
        this.retryAfter=this.now()+(this.options.retryMs??HARNESS_METADATA_RETRY_MS);
        this.lastError=this.options.error;
        if(this.entry)return this.result(this.entry,'stale');
        throw error;
      })
      .finally(()=>{if(this.refresh?.promise===promise)this.refresh=undefined;});
    this.refresh={generation,promise};
    return promise;
  }

  private result(entry:CacheEntry<T>,state:HarnessCacheMetadata['state']):CacheRead<T>{
    return{
      value:entry.value,
      cache:{
        state,
        refreshedAt:new Date(entry.refreshedAt).toISOString(),
        expiresAt:new Date(entry.expiresAt).toISOString(),
        ...(this.lastError?{error:this.lastError}:{}),
      },
    };
  }

  private now(){return(this.options.now??Date.now)();}
}

export const unavailableHarnessCache=(error:HarnessCacheError):HarnessCacheMetadata=>({
  state:'stale',
  refreshedAt:null,
  expiresAt:null,
  error,
});
