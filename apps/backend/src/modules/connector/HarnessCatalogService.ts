import type {ConnectorInstance} from '@agenvyl/connector-contract';
import type {ConnectorDiscovery} from './connector.ports.js';
import {AppError} from '../../shared/errors/AppError.js';

class ConnectorCatalogIdentityError extends Error{}

export class HarnessCatalogService{
  constructor(private readonly connector?:ConnectorDiscovery){}

  async catalog(){
    if(!this.connector)throw new AppError('connector_unavailable',503,'Connector catalog is not configured');
    try{
      const discovered=await this.connector.instances();
      const instances=await Promise.all(discovered.instances.map(async instance=>{
        if(instance.status==='unavailable'||!instance.capabilities.includes('model_catalog'))return{...instance,models:[],controls:emptyControls()};
        try{
          const catalog=await this.connector!.catalog(instance.id);
          if(catalog.connectorEpoch!==discovered.connectorEpoch||catalog.instanceId!==instance.id)throw new ConnectorCatalogIdentityError('Connector catalog identity changed during discovery');
          return{...instance,models:catalog.models,controls:catalog.controls};
        }catch(error){
          if(error instanceof ConnectorCatalogIdentityError)throw error;
          return unavailableCatalog(instance);
        }
      }));
      return{connectorEpoch:discovered.connectorEpoch,instances};
    }catch{throw new AppError('connector_unavailable',503,'Connector catalog is unavailable');}
  }
}

const unavailableCatalog=(instance:ConnectorInstance)=>({
  ...instance,
  status:'unavailable' as const,
  error:{code:'catalog_unavailable',message:'Connector instance catalog is unavailable'},
  models:[],
  controls:emptyControls(),
});

const emptyControls=()=>({nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]});
