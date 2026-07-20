import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type AgenvylPaths = {
  config: string;
  data: string;
  connectorConfig: string;
  workspaces: string;
};

export function resolveAgenvylPaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): AgenvylPaths {
  const configHome = absoluteXdgPath(env.XDG_CONFIG_HOME, join(home, '.config'), 'XDG_CONFIG_HOME');
  const dataHome = absoluteXdgPath(env.XDG_DATA_HOME, join(home, '.local', 'share'), 'XDG_DATA_HOME');
  const config = join(configHome, 'agenvyl');
  const data = join(dataHome, 'agenvyl');
  return {
    config,
    data,
    connectorConfig: join(config, 'connector.yaml'),
    workspaces: join(data, 'workspaces'),
  };
}

function absoluteXdgPath(value: string | undefined, fallback: string, name: string) {
  if (!value) return resolve(fallback);
  if (!value.startsWith('/')) throw new Error(`${name} must be an absolute path`);
  return resolve(value);
}
