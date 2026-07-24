import {describe,expect,it,vi} from 'vitest';
import {connectorContractFixtures} from '@agenvyl/connector-contract';
import type {ConnectorDiscovery} from './connector.ports.js';
import {HarnessCatalogService} from './HarnessCatalogService.js';

describe('HarnessCatalogService',()=>{
  it('caches the aggregate catalog and force-refreshes on demand',async()=>{
    const connector=connectorFixture();
    const service=new HarnessCatalogService(connector);
    const first=await service.catalog(),second=await service.catalog();
    expect(first.cache.state).toBe('fresh');
    expect(second).toEqual(first);
    expect(connector.instances).toHaveBeenCalledTimes(1);
    expect(connector.catalog).toHaveBeenCalledTimes(1);
    await service.catalog({forceRefresh:true});
    expect(connector.instances).toHaveBeenCalledTimes(2);
    expect(connector.catalog).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous same-epoch catalog when one instance refresh fails',async()=>{
    let now=0,failHermes=false;
    const instances={...connectorContractFixtures.instances,instances:[
      connectorContractFixtures.instances.instances[0],
      {...connectorContractFixtures.instances.instances[0],id:'local-opencode',type:'opencode'},
    ]};
    const connector=connectorFixture({
      instances:vi.fn().mockResolvedValue(instances),
      catalog:vi.fn().mockImplementation(async(instanceId:string)=>{
        if(failHermes&&instanceId==='local-hermes')throw new Error('Hermes is offline');
        return{...connectorContractFixtures.catalog,instanceId};
      }),
    });
    const service=new HarnessCatalogService(connector,{now:()=>now});
    await service.catalog();
    now=300_001;failHermes=true;
    const refreshed=await service.catalog({forceRefresh:true});
    expect(refreshed.instances[0]).toMatchObject({
      id:'local-hermes',
      status:'healthy',
      models:connectorContractFixtures.catalog.models,
      catalogCache:{state:'stale',error:{code:'catalog_unavailable'}},
    });
    expect(refreshed.instances[1]).toMatchObject({id:'local-opencode',catalogCache:{state:'fresh'}});
  });

  it('does not reuse instance catalogs across Connector epochs',async()=>{
    let epoch='epoch-1',fail=false;
    const connector=connectorFixture({
      instances:vi.fn().mockImplementation(async()=>({...connectorContractFixtures.instances,connectorEpoch:epoch})),
      catalog:vi.fn().mockImplementation(async()=>{
        if(fail)throw new Error('offline');
        return connectorContractFixtures.catalog;
      }),
    });
    const service=new HarnessCatalogService(connector);
    await service.catalog();
    epoch='epoch-2';fail=true;
    const refreshed=await service.catalog({forceRefresh:true});
    expect(refreshed.connectorEpoch).toBe('epoch-2');
    expect(refreshed.instances[0]).toMatchObject({models:[],catalogCache:{state:'unavailable',refreshedAt:null}});
  });

  it('serves a stale catalog after an aggregate refresh failure',async()=>{
    let now=0,offline=false;
    const connector=connectorFixture({
      instances:vi.fn().mockImplementation(async()=>{
        if(offline)throw new Error('offline');
        return connectorContractFixtures.instances;
      }),
    });
    const service=new HarnessCatalogService(connector,{now:()=>now});
    await service.catalog();
    now=300_001;offline=true;
    const stale=await service.catalog({forceRefresh:true});
    expect(stale.cache).toMatchObject({state:'stale',error:{code:'connector_unavailable'}});
    expect(stale.instances[0]).toMatchObject({catalogCache:{state:'stale'},models:connectorContractFixtures.catalog.models});
  });

  it('rejects a catalog observed across a Connector epoch change',async()=>{
    const connector=connectorFixture({
      catalog:vi.fn().mockResolvedValue({...connectorContractFixtures.catalog,connectorEpoch:'epoch-new'}),
    });
    await expect(new HarnessCatalogService(connector).catalog()).rejects.toMatchObject({code:'connector_unavailable',statusCode:503});
  });
});

const connectorFixture=(patch:Partial<ConnectorDiscovery>={}):ConnectorDiscovery=>({
  health:vi.fn().mockResolvedValue(connectorContractFixtures.health),
  inspect:vi.fn().mockResolvedValue(connectorContractFixtures.execution),
  instances:vi.fn().mockResolvedValue(connectorContractFixtures.instances),
  catalog:vi.fn().mockResolvedValue(connectorContractFixtures.catalog),
  ...patch,
});
