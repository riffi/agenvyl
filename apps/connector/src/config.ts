import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { parse } from 'yaml';

export type ConnectorInstanceConfig = { id: string; type: string; enabled: boolean };
export type ConnectorConfig = {
  version: 1;
  listen: { host: string; port: number };
  workspaces: { roots: string[] };
  instances: ConnectorInstanceConfig[];
  token: string;
};

export async function loadConnectorConfig(options: { path?: string; env?: NodeJS.ProcessEnv } = {}): Promise<ConnectorConfig> {
  const env = options.env ?? process.env;
  const path = options.path ?? env.AGENVYL_CONNECTOR_CONFIG ?? './connector.yaml';
  const token = env.AGENVYL_CONNECTOR_TOKEN;
  if (!token || token.length < 32) throw new Error('AGENVYL_CONNECTOR_TOKEN must contain at least 32 characters');
  let source: string;
  try { source = await readFile(path, 'utf8'); } catch { throw new Error('Unable to read Connector config'); }
  let document: unknown;
  try { document = parse(source) as unknown; } catch { throw new Error('Unable to parse Connector YAML config'); }
  if (!isRecord(document)) throw new Error('Connector config must be a YAML object');
  exactKeys(document, ['version', 'listen', 'workspaces', 'instances'], 'connector config');
  if (document.version !== 1) throw new Error('Connector config version must be 1');
  const listen = parseListen(document.listen);
  const workspaces = parseWorkspaces(document.workspaces);
  const instances = parseInstances(document.instances);
  return { version: 1, listen, workspaces, instances, token };
}

function parseListen(value: unknown) {
  if (value === undefined) return { host: '127.0.0.1', port: 4310 };
  if (!isRecord(value)) throw new Error('listen must be an object');
  exactKeys(value, ['host', 'port'], 'listen');
  const host = value.host ?? '127.0.0.1', port = value.port ?? 4310;
  if (typeof host !== 'string' || !host.trim()) throw new Error('listen.host must be a non-empty string');
  if (!Number.isSafeInteger(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('listen.port must be an integer between 1 and 65535');
  return { host, port: Number(port) };
}

function parseInstances(value: unknown): ConnectorInstanceConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('instances must be an array');
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`instances[${index}] must be an object`);
    exactKeys(item, ['id', 'type', 'enabled'], `instances[${index}]`);
    if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(item.id)) throw new Error(`instances[${index}].id is invalid`);
    if (seen.has(item.id)) throw new Error(`Duplicate Connector instance id: ${item.id}`);
    seen.add(item.id);
    if (typeof item.type !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(item.type)) throw new Error(`instances[${index}].type is invalid`);
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new Error(`instances[${index}].enabled must be boolean`);
    return { id: item.id, type: item.type, enabled: item.enabled ?? true };
  });
}

function parseWorkspaces(value: unknown) {
  if (value === undefined) return { roots: [] };
  if (!isRecord(value)) throw new Error('workspaces must be an object');
  exactKeys(value, ['roots'], 'workspaces');
  if (!Array.isArray(value.roots)) throw new Error('workspaces.roots must be an array');
  const roots = value.roots.map((root, index) => {
    if (typeof root !== 'string' || !root.trim() || !isAbsolute(root)) throw new Error(`workspaces.roots[${index}] must be an absolute path`);
    return root;
  });
  if (new Set(roots).size !== roots.length) throw new Error('workspaces.roots contains duplicate paths');
  return { roots };
}

function exactKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains unsupported keys: ${unknown.join(', ')}`);
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
