import { spawn } from 'node:child_process';
import type { SupervisorConfig } from './config.js';

export function openWebUi(config: SupervisorConfig, path = '/') {
  const url = `http://127.0.0.1:${config.corePort}${path}`;
  const command = config.platform === 'win32' ? { file: 'cmd.exe', args: ['/d', '/c', 'start', '', url] } : config.platform === 'darwin' ? { file: 'open', args: [url] } : { file: 'xdg-open', args: [url] };
  const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => undefined);
  child.unref();
  return url;
}
