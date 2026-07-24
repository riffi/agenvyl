import {describe,expect,it,vi} from 'vitest';
import type {Database} from '../../infrastructure/database/Database.js';
import type {HttpConnectorClient} from '../../integrations/connector/HttpConnectorClient.js';
import {SetupService} from './SetupService.js';

describe('SetupService harness discovery cache',()=>{
  it('shares discovery across settings reads, force-refreshes, and invalidates after configuration',async()=>{
    const connector=connectorFixture(),catalogCache={invalidate:vi.fn()};
    const service=new SetupService(databaseFixture(),connector,'C:/workspaces',catalogCache);
    await service.harnessSettings();
    await service.harnessSettings();
    expect(connector.discover).toHaveBeenCalledTimes(1);

    await service.harnessSettings({forceRefresh:true});
    expect(connector.discover).toHaveBeenCalledTimes(2);

    await service.configure({instances:[]});
    expect(catalogCache.invalidate).toHaveBeenCalledOnce();
    await service.harnessSettings();
    expect(connector.discover).toHaveBeenCalledTimes(3);
  });

  it('returns stale discovery metadata after a failed forced refresh',async()=>{
    const connector=connectorFixture();
    const service=new SetupService(databaseFixture(),connector,'C:/workspaces',{invalidate:vi.fn()});
    await service.harnessSettings();
    connector.discover.mockRejectedValueOnce(new Error('offline'));
    const stale=await service.harnessSettings({forceRefresh:true});
    expect(stale).toMatchObject({candidates:[],discoveryCache:{state:'stale',error:{code:'discovery_unavailable'}}});
  });
});

const databaseFixture=()=>({sql:vi.fn().mockResolvedValue([])}) as unknown as Database;

const connectorFixture=()=>{
  const connector={
    configuration:vi.fn().mockResolvedValue({apiVersion:'v2',instances:[]}),
    instances:vi.fn().mockResolvedValue({apiVersion:'v2',connectorEpoch:'epoch',instances:[]}),
    discover:vi.fn().mockResolvedValue({apiVersion:'v2',candidates:[]}),
    configureInstances:vi.fn().mockResolvedValue({apiVersion:'v2',instances:[]}),
  };
  return connector as unknown as HttpConnectorClient&typeof connector;
};
