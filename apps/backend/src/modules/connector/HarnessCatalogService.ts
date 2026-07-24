import type {FastifyBaseLogger} from 'fastify';
import type {ConnectorCatalog,ConnectorInstance} from '@agenvyl/connector-contract';
import type {ConnectorDiscovery} from './connector.ports.js';
import {AppError} from '../../shared/errors/AppError.js';
import {HarnessMetadataCache,type HarnessCacheError,type HarnessCacheMetadata} from './HarnessMetadataCache.js';

class ConnectorCatalogIdentityError extends Error{}

type CatalogCacheMetadata={
  state:'fresh'|'stale'|'unavailable';
  refreshedAt:string|null;
  error?:HarnessCacheError;
};
type CatalogData=Pick<ConnectorCatalog,'models'|'controls'>;
type SuccessfulCatalog=CatalogData&{refreshedAt:string};
type CatalogInstance=ConnectorInstance&CatalogData&{catalogCache:CatalogCacheMetadata};
type CatalogValue={
  catalog:{connectorEpoch:string;instances:CatalogInstance[]};
  successful:Map<string,SuccessfulCatalog>;
};

const refreshError={code:'connector_unavailable',message:'Harness catalog refresh failed'};
const instanceRefreshError={code:'catalog_unavailable',message:'Connector instance catalog is unavailable'};

export class HarnessCatalogService{
  private readonly cache:HarnessMetadataCache<CatalogValue>;
  private readonly now:()=>number;
  private readonly logger?:Pick<FastifyBaseLogger,'info'|'warn'>;

  constructor(private readonly connector?:ConnectorDiscovery,options:{
    ttlMs?:number;
    retryMs?:number;
    now?:()=>number;
    logger?:Pick<FastifyBaseLogger,'info'|'warn'>;
  }={}){
    this.now=options.now??Date.now;
    this.logger=options.logger;
    this.cache=new HarnessMetadataCache<CatalogValue>({...options,error:refreshError});
  }

  async catalog(options:{forceRefresh?:boolean}={}){
    if(!this.connector)throw new AppError('connector_unavailable',503,'Connector catalog is not configured');
    try{
      const result=await this.cache.read(()=>this.refreshCatalog(),options.forceRefresh);
      const catalog=result.cache.state==='stale'?staleCatalog(result.value.catalog,result.cache):result.value.catalog;
      return{...catalog,cache:result.cache};
    }catch{
      throw new AppError('connector_unavailable',503,'Connector catalog is unavailable');
    }
  }

  invalidate(){this.cache.invalidate();}

  private async refreshCatalog():Promise<CatalogValue>{
    const startedAt=this.now();
    try{
      const discovered=await this.connector!.instances();
      const previous=this.cache.current();
      const previousSuccessful=previous?.catalog.connectorEpoch===discovered.connectorEpoch?previous.successful:new Map<string,SuccessfulCatalog>();
      const successful=new Map(previousSuccessful);
      let updated=0,failed=0;
      const instances=await Promise.all(discovered.instances.map(async instance=>{
        if(instance.status==='unavailable'||!instance.capabilities.includes('model_catalog')){
          failed+=1;
          return unavailableCatalog(instance,previousSuccessful.get(instance.id));
        }
        try{
          const catalog=await this.connector!.catalog(instance.id);
          if(catalog.connectorEpoch!==discovered.connectorEpoch||catalog.instanceId!==instance.id)throw new ConnectorCatalogIdentityError('Connector catalog identity changed during discovery');
          const refreshedAt=new Date(this.now()).toISOString();
          const value={models:catalog.models,controls:catalog.controls,refreshedAt};
          successful.set(instance.id,value);
          updated+=1;
          return{...instance,models:value.models,controls:value.controls,catalogCache:{state:'fresh' as const,refreshedAt}};
        }catch(error){
          if(error instanceof ConnectorCatalogIdentityError)throw error;
          failed+=1;
          return unavailableCatalog(instance,previousSuccessful.get(instance.id));
        }
      }));
      this.logger?.info({durationMs:this.now()-startedAt,updated,failed,instances:instances.length,connectorEpoch:discovered.connectorEpoch},'Harness catalog refresh completed');
      return{catalog:{connectorEpoch:discovered.connectorEpoch,instances},successful};
    }catch(error){
      this.logger?.warn({durationMs:this.now()-startedAt,err:error},'Harness catalog refresh failed; stale data will be used when available');
      throw error;
    }
  }
}

const unavailableCatalog=(instance:ConnectorInstance,previous?:SuccessfulCatalog):CatalogInstance=>{
  if(previous)return{
    ...instance,
    models:previous.models,
    controls:previous.controls,
    catalogCache:{state:'stale',refreshedAt:previous.refreshedAt,error:instanceRefreshError},
  };
  return{
    ...instance,
    models:[],
    controls:emptyControls(),
    catalogCache:{state:'unavailable',refreshedAt:null,error:instanceRefreshError},
  };
};

const staleCatalog=(catalog:CatalogValue['catalog'],cache:HarnessCacheMetadata):CatalogValue['catalog']=>({
  ...catalog,
  instances:catalog.instances.map(instance=>instance.catalogCache.state==='fresh'?{
    ...instance,
    catalogCache:{state:'stale',refreshedAt:instance.catalogCache.refreshedAt,error:cache.error??refreshError},
  }:instance),
});

const emptyControls=():ConnectorCatalog['controls']=>({nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]});
