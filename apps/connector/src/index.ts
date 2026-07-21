import { buildConnectorApp } from './app.js';
import { buildConfiguredAdapters } from './adapters/factory.js';
import { loadConnectorConfig } from './config.js';
import { saveConnectorInstances } from './config.js';
import { discoverHarnesses } from './discovery.js';
import {ManagedHarnessServers} from './managed-servers.js';

try {
  const config = await loadConnectorConfig();
  const managed=new ManagedHarnessServers();
  await managed.apply(config.instances);
  const adapters = buildConfiguredAdapters(config);
  const app = buildConnectorApp(config, { logger: true, adapters,discover:()=>discoverHarnesses(),configureInstances:async instances=>{await managed.apply(instances);return buildConfiguredAdapters({...config,instances});},persistInstances:instances=>saveConnectorInstances(config,instances) });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    managed.close();
    await app.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await app.listen({...config.listen});
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Connector failed to start');
  process.exitCode = 1;
}
