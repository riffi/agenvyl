import type {ConnectorDiscovery} from './connector.ports.js';
import {AppError} from '../../shared/errors/AppError.js';

export class HarnessCatalogService{
  constructor(private readonly connector?:ConnectorDiscovery){}

  async catalog(){
    if(!this.connector)throw new AppError('connector_unavailable',503,'Connector catalog is not configured');
    try{
      const discovered=await this.connector.instances();
      const instances=await Promise.all(discovered.instances.map(async instance=>{
        if(instance.status==='unavailable'||!instance.capabilities.some(capability=>capability==='model_catalog'||capability==='mode_catalog'))return{...instance,models:[],modes:[]};
        const catalog=await this.connector!.catalog(instance.id);
        if(catalog.connectorEpoch!==discovered.connectorEpoch||catalog.instanceId!==instance.id)throw new Error('Connector catalog identity changed during discovery');
        return{...instance,models:catalog.models,modes:catalog.modes};
      }));
      return{connectorEpoch:discovered.connectorEpoch,instances};
    }catch{throw new AppError('connector_unavailable',503,'Connector catalog is unavailable');}
  }
}
