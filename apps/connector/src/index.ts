import { buildConnectorApp } from './app.js';
import { buildConfiguredAdapters } from './adapters/factory.js';
import { loadConnectorConfig } from './config.js';

try {
  const config = await loadConnectorConfig();
  const adapters = buildConfiguredAdapters(config);
  const app = buildConnectorApp(config, { logger: true, adapters });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await app.listen(config.listen);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Connector failed to start');
  process.exitCode = 1;
}
