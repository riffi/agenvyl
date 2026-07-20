import {describe,expect,it,vi} from 'vitest';
import {connectorContractFixtures} from '@agenvyl/connector-contract';
import type {ConnectorDiscovery} from './connector.ports.js';
import {HarnessCatalogService} from './HarnessCatalogService.js';

describe('HarnessCatalogService',()=>{
  it('rejects a catalog observed across a Connector epoch change',async()=>{
    const connector:ConnectorDiscovery={
      health:vi.fn().mockResolvedValue(connectorContractFixtures.health),inspect:vi.fn().mockResolvedValue(connectorContractFixtures.execution),
      instances:vi.fn().mockResolvedValue(connectorContractFixtures.instances),
      catalog:vi.fn().mockResolvedValue({...connectorContractFixtures.catalog,connectorEpoch:'epoch-new'}),
    };
    await expect(new HarnessCatalogService(connector).catalog()).rejects.toMatchObject({code:'connector_unavailable',statusCode:503});
  });
});
