import {describe,expect,it,vi} from 'vitest';
import {connectorContractFixtures} from '@agenvyl/connector-contract';
import type {ConnectorDiscovery} from './connector.ports.js';
import {HarnessCatalogService} from './HarnessCatalogService.js';

describe('HarnessCatalogService',()=>{
  it('keeps available catalogs when one instance catalog is unavailable',async()=>{
    const instances={...connectorContractFixtures.instances,instances:[
      connectorContractFixtures.instances.instances[0],
      {...connectorContractFixtures.instances.instances[0],id:'local-opencode',type:'opencode'},
    ]};
    const connector:ConnectorDiscovery={
      health:vi.fn().mockResolvedValue(connectorContractFixtures.health),inspect:vi.fn().mockResolvedValue(connectorContractFixtures.execution),
      instances:vi.fn().mockResolvedValue(instances),
      catalog:vi.fn().mockImplementation(async instanceId=>{
        if(instanceId==='local-hermes')throw new Error('Hermes is offline');
        return{...connectorContractFixtures.catalog,instanceId};
      }),
    };

    await expect(new HarnessCatalogService(connector).catalog()).resolves.toEqual({
      connectorEpoch:'epoch-1',
      instances:[
        {...instances.instances[0],status:'unavailable',error:{code:'catalog_unavailable',message:'Connector instance catalog is unavailable'},models:[],controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]}},
        {...instances.instances[1],models:connectorContractFixtures.catalog.models,controls:connectorContractFixtures.catalog.controls},
      ],
    });
  });

  it('rejects a catalog observed across a Connector epoch change',async()=>{
    const connector:ConnectorDiscovery={
      health:vi.fn().mockResolvedValue(connectorContractFixtures.health),inspect:vi.fn().mockResolvedValue(connectorContractFixtures.execution),
      instances:vi.fn().mockResolvedValue(connectorContractFixtures.instances),
      catalog:vi.fn().mockResolvedValue({...connectorContractFixtures.catalog,connectorEpoch:'epoch-new'}),
    };
    await expect(new HarnessCatalogService(connector).catalog()).rejects.toMatchObject({code:'connector_unavailable',statusCode:503});
  });
});
