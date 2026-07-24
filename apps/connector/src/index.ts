import { buildConnectorApp } from './app.js';
import { buildConfiguredAdapters } from './adapters/factory.js';
import { addOpenCodeExternalDirectoryRoot,loadConnectorConfig,saveConnectorInstances } from './config.js';
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
  await managed.apply(config.instances);
  const adapters = buildConfiguredAdapters(config,process.env,fetch,adapterOptions);
  const app = buildConnectorApp(config, { logger: true, adapters,discover:()=>discoverHarnesses(),configureInstances:async instances=>{await managed.apply(instances);return buildConfiguredAdapters({...config,instances},process.env,fetch,adapterOptions);},persistInstances:instances=>saveConnectorInstances(config,instances) });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    managed.close();
    await app.close();
    await claudePermissions.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await app.listen({...config.listen});
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Connector failed to start');
  process.exitCode = 1;
}
