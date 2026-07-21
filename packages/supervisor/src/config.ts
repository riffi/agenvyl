import { resolveAgenvylPaths, type AgenvylPlatform } from '@agenvyl/runtime-config';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type SupervisorConfig = {
  platform: AgenvylPlatform;
  bundleRoot: string;
  appRoot: string;
  nodeExecutable: string;
  coreEntrypoint: string;
  connectorEntrypoint: string;
  postgresRoot: string;
  managedPostgres: boolean;
  externalDatabaseUrl?: string;
  corePort: number;
  connectorPort: number;
  postgresPort: number;
  paths: ReturnType<typeof resolveAgenvylPaths>;
  stateFile: string;
  lockFile: string;
  stopRequestFile: string;
  secretsFile: string;
  connectorConfigFile: string;
  settingsFile: string;
  userBinDirectory: string;
  userCommandPath: string;
  userProfileFile: string;
  gracePeriodMs: number;
  readinessTimeoutMs: number;
};

export function resolveSupervisorConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { home?: string; platform?: AgenvylPlatform; cwd?: string } = {},
): SupervisorConfig {
  const platform = options.platform ?? supportedPlatform(process.platform);
  const paths = resolveAgenvylPaths(env, options.home ?? env.AGENVYL_HOME, platform);
  const bundleRoot = absolute(env.AGENVYL_BUNDLE_ROOT ?? options.cwd ?? process.cwd(), 'AGENVYL_BUNDLE_ROOT');
  const appRoot = absolute(env.AGENVYL_APP_ROOT ?? join(bundleRoot, 'app'), 'AGENVYL_APP_ROOT');
  const postgresRoot = absolute(env.AGENVYL_POSTGRES_ROOT ?? join(bundleRoot, 'postgres'), 'AGENVYL_POSTGRES_ROOT');
  const externalDatabaseUrl = env.AGENVYL_DATABASE_URL?.trim() || undefined;
  const userHome = options.home ?? env.AGENVYL_HOME ?? homedir();
  const userBinDirectory = absolute(env.AGENVYL_USER_BIN_DIR ?? (platform === 'win32' ? join(paths.data, 'bin') : join(userHome, '.local', 'bin')), 'AGENVYL_USER_BIN_DIR');
  return {
    platform,
    bundleRoot,
    appRoot,
    nodeExecutable: absolute(env.AGENVYL_NODE_EXECUTABLE ?? process.execPath, 'AGENVYL_NODE_EXECUTABLE'),
    coreEntrypoint: absolute(env.AGENVYL_CORE_ENTRYPOINT ?? join(appRoot, 'apps/backend/dist/index.js'), 'AGENVYL_CORE_ENTRYPOINT'),
    connectorEntrypoint: absolute(env.AGENVYL_CONNECTOR_ENTRYPOINT ?? join(appRoot, 'apps/connector/dist/index.js'), 'AGENVYL_CONNECTOR_ENTRYPOINT'),
    postgresRoot,
    managedPostgres: !externalDatabaseUrl,
    externalDatabaseUrl,
    corePort: port(env.AGENVYL_PORT, 8791, 'AGENVYL_PORT'),
    connectorPort: port(env.AGENVYL_CONNECTOR_PORT, 4310, 'AGENVYL_CONNECTOR_PORT'),
    postgresPort: port(env.AGENVYL_POSTGRES_PORT, 8793, 'AGENVYL_POSTGRES_PORT'),
    paths,
    stateFile: join(paths.state, 'supervisor.json'),
    lockFile: join(paths.state, 'supervisor.lock'),
    stopRequestFile: join(paths.state, 'stop-request'),
    secretsFile: join(paths.config, 'secrets.json'),
    connectorConfigFile: env.AGENVYL_CONNECTOR_CONFIG ?? paths.connectorConfig,
    settingsFile: join(paths.config, 'supervisor-settings.json'),
    userBinDirectory,
    userCommandPath: join(userBinDirectory, platform === 'win32' ? 'agenvyl.cmd' : 'agenvyl'),
    userProfileFile: absolute(env.AGENVYL_PATH_PROFILE ?? join(userHome, platform === 'darwin' ? '.zprofile' : '.profile'), 'AGENVYL_PATH_PROFILE'),
    gracePeriodMs: positiveInteger(env.AGENVYL_SHUTDOWN_TIMEOUT_MS, 10_000, 'AGENVYL_SHUTDOWN_TIMEOUT_MS'),
    readinessTimeoutMs: positiveInteger(env.AGENVYL_READINESS_TIMEOUT_MS, 60_000, 'AGENVYL_READINESS_TIMEOUT_MS'),
  };
}

function supportedPlatform(value: NodeJS.Platform): AgenvylPlatform {
  if (value === 'linux' || value === 'darwin' || value === 'win32') return value;
  throw new Error(`Unsupported Agenvyl platform: ${value}`);
}
function absolute(value: string, name: string) {
  const result = resolve(value);
  if (!result) throw new Error(`${name} must be an absolute path`);
  return result;
}
function port(value: string | undefined, fallback: number, name: string) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error(`${name} must be an integer between 1 and 65535`);
  return parsed;
}
function positiveInteger(value: string | undefined, fallback: number, name: string) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
