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

  it('starts setup state from saved configuration when discovery and runtime are empty',async()=>{
    const connector=connectorFixture();
    connector.configuration.mockResolvedValueOnce({apiVersion:'v2',instances:[{id:'custom-hermes',type:'hermes',enabled:true,endpoint:'http://127.0.0.1:9000'}]});
    const database={sql:vi.fn().mockResolvedValue([{completed_at:null,locale:'en',first_room_id:null}])} as unknown as Database;
    const state=await new SetupService(database,connector,'C:/workspaces',{invalidate:vi.fn()}).state();
    expect(state.instances).toEqual([{id:'custom-hermes',type:'hermes',enabled:true,endpoint:'http://127.0.0.1:9000',status:'unavailable'}]);
  });

  it('returns a native folder selection without changing setup state',async()=>{
    const directoryPicker=vi.fn().mockResolvedValue('/Users/test/workspaces');
    const service=new SetupService(databaseFixture(),connectorFixture(),'/default',{invalidate:vi.fn()},{directoryPicker});
    await expect(service.selectWorkspaceDirectory()).resolves.toEqual({path:'/Users/test/workspaces'});
    expect(directoryPicker).toHaveBeenCalledOnce();
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
