import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export * from './supervisor.js';

export type AgenvylPlatform = 'linux' | 'darwin' | 'win32';

export type AgenvylPaths = {
  config: string;
  data: string;
  backups: string;
  connectorConfig: string;
  logs: string;
  postgres: string;
  state: string;
  workspaces: string;
};

export function resolveAgenvylPaths(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  platform: AgenvylPlatform = supportedPlatform(process.platform),
): AgenvylPaths {
  const path = platform === 'win32' ? win32 : posix;
  const { configHome, dataHome } = platformHomes(env, home, platform, path);
  const config = path.join(configHome, platform === 'linux' ? 'agenvyl' : 'Agenvyl');
  const data = path.join(dataHome, platform === 'linux' ? 'agenvyl' : 'Agenvyl');
  return {
    config,
    data,
    backups: path.join(data, 'backups'),
    connectorConfig: path.join(config, 'connector.yaml'),
    logs: path.join(data, 'logs'),
    postgres: path.join(data, 'postgres'),
    state: path.join(data, 'state'),
    workspaces: path.join(data, 'workspaces'),
  };
}

function platformHomes(
  env: NodeJS.ProcessEnv,
  home: string,
  platform: AgenvylPlatform,
  path: typeof posix | typeof win32,
) {
  if (platform === 'win32') {
    const localAppData = absolutePath(env.LOCALAPPDATA, path.join(home, 'AppData', 'Local'), 'LOCALAPPDATA', path);
    return { configHome: localAppData, dataHome: localAppData };
  }
  if (platform === 'darwin') {
    const applicationSupport = path.join(home, 'Library', 'Application Support');
    return { configHome: applicationSupport, dataHome: applicationSupport };
  }
  return {
    configHome: absolutePath(env.XDG_CONFIG_HOME, path.join(home, '.config'), 'XDG_CONFIG_HOME', path),
    dataHome: absolutePath(env.XDG_DATA_HOME, path.join(home, '.local', 'share'), 'XDG_DATA_HOME', path),
  };
}

function absolutePath(value: string | undefined, fallback: string, name: string, path: typeof posix | typeof win32) {
  const selected = value || fallback;
  if (!path.isAbsolute(selected)) throw new Error(`${name} must be an absolute path`);
  return path.resolve(selected);
}

function supportedPlatform(platform: NodeJS.Platform): AgenvylPlatform {
  if (platform === 'linux' || platform === 'darwin' || platform === 'win32') return platform;
  throw new Error(`Unsupported Agenvyl platform: ${platform}`);
}
