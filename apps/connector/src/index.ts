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
  const initialManagedRuntime=await managed.acquireAvailable(config.instances);
  let app:ReturnType<typeof buildConnectorApp>;
  try{
    const adapters = buildConfiguredAdapters(config,process.env,fetch,adapterOptions);
    const prepareRuntime=async(instances:typeof config.instances)=>{const lease=await managed.acquire(instances);try{return{adapters:buildConfiguredAdapters({...config,instances},process.env,fetch,adapterOptions),release:lease.release};}catch(error){await lease.release();throw error;}};
    app = buildConnectorApp(config, { logger: true, adapters,releaseInitialRuntime:initialManagedRuntime.release,initialRuntimeErrors:initialManagedRuntime.errors,discover:()=>discoverHarnesses(),configureInstances:prepareRuntime,restartInstance:async instance=>{await managed.restart(instance);return prepareRuntime(config.instances);},persistInstances:instances=>saveConnectorInstances(config,instances),persistWorkspaces:roots=>saveConnectorWorkspaces(config,roots) });
  }catch(error){await initialManagedRuntime.release();await managed.close();await claudePermissions.close();throw error;}
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await managed.close();
    await claudePermissions.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await app.listen({...config.listen});
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Connector failed to start');
  process.exitCode = 1;
}
