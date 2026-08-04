import { buildConnectorApp } from './app.js';
import { buildConfiguredAdapters } from './adapters/factory.js';
import { addOpenCodeExternalDirectoryRoot,loadConnectorConfig,saveConnectorInstances,saveConnectorWorkspaces } from './config.js';
import { discoverHarnesses } from './discovery.js';
import {ManagedHarnessServers} from './managed-servers.js';
import {ClaudePermissionMcpBridge} from './adapters/claude/permission-bridge.js';

try {
  const config = await loadConnectorConfig();
  const managed=new ManagedHarnessServers();
  const claudePermissions=new ClaudePermissionMcpBridge();
  let externalDirectoryGrantQueue=Promise.resolve();
  const grantOpenCodeExternalDirectoryRoot=(instanceId:string,root:string)=>{
    const operation=externalDirectoryGrantQueue.then(()=>addOpenCodeExternalDirectoryRoot(config,instanceId,root)).then(()=>undefined);
    externalDirectoryGrantQueue=operation.catch(()=>undefined);
    return operation;
  };
  const adapterOptions={claudePermissionBridge:claudePermissions,grantOpenCodeExternalDirectoryRoot};
  const initialManagedLease=await managed.acquire(config.instances);
  let app:ReturnType<typeof buildConnectorApp>;
  try{
    const adapters = buildConfiguredAdapters(config,process.env,fetch,adapterOptions);
    app = buildConnectorApp(config, { logger: true, adapters,releaseInitialRuntime:initialManagedLease.release,discover:()=>discoverHarnesses(),configureInstances:async instances=>{const lease=await managed.acquire(instances);try{return{adapters:buildConfiguredAdapters({...config,instances},process.env,fetch,adapterOptions),release:lease.release};}catch(error){lease.release();throw error;}},persistInstances:instances=>saveConnectorInstances(config,instances),persistWorkspaces:roots=>saveConnectorWorkspaces(config,roots) });
  }catch(error){initialManagedLease.release();managed.close();await claudePermissions.close();throw error;}
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    managed.close();
    await claudePermissions.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await app.listen({...config.listen});
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Connector failed to start');
  process.exitCode = 1;
}
