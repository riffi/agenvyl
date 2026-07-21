import { readFile, readdir, stat } from 'node:fs/promises';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

export async function assertLoopbackOnly(ports) {
  const addresses = Object.values(networkInterfaces())
    .flatMap(entries => entries ?? [])
    .filter(entry => !entry.internal)
    .map(entry => entry.address);

  const probes = addresses.flatMap(address => ports.map(async port => ({ address, port, reachable: await canConnect(address, port) })));
  for (const probe of await Promise.all(probes)) {
    if (probe.reachable) throw new Error(`Portable service is reachable outside loopback at ${probe.address}:${probe.port}`);
  }
}

export async function assertSecretsConfined({ roots, secretsFile, observed = [] }) {
  const secrets = JSON.parse(await readFile(secretsFile, 'utf8'));
  const values = [secrets.connectorToken, secrets.postgresPassword]
    .filter(value => typeof value === 'string' && value.length >= 32);
  if (values.length !== 2) throw new Error('Portable secrets file does not contain two strong generated credentials');

  if (process.platform !== 'win32') {
    const mode = (await stat(secretsFile)).mode & 0o777;
    if ((mode & 0o077) !== 0) throw new Error(`Portable secrets file permissions are too broad: ${mode.toString(8)}`);
  }

  for (const text of observed) assertAbsent(text, values, 'command output');
  const excluded = new Set([resolve(secretsFile)]);
  for (const root of new Set(roots.map(root => resolve(root)))) await scan(root, values, excluded);
}

async function scan(path, secrets, excluded) {
  let metadata;
  try {
    metadata = await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (excluded.has(resolve(path))) return;
  if (metadata.isDirectory()) {
    if (/(?:^|[\\/])postgres(?:[\\/]|$)/i.test(path)) return;
    for (const entry of await readdir(path)) await scan(resolve(path, entry), secrets, excluded);
    return;
  }
  if (!metadata.isFile() || metadata.size > 5_000_000) return;
  const buffer = await readFile(path);
  if (buffer.includes(0)) return;
  assertAbsent(buffer.toString('utf8'), secrets, path);
}

function assertAbsent(text, secrets, source) {
  for (const secret of secrets) if (text.includes(secret)) throw new Error(`Generated credential leaked into ${source}`);
}

function canConnect(host, port) {
  return new Promise(resolveConnection => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = connected => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveConnection(connected);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
