import { createInterface } from 'node:readline/promises';
import type { SupervisorConfig } from './config.js';
import { openWebUi } from './browser.js';
import { startSupervisor } from './runtime.js';

export type HarnessType = 'hermes' | 'opencode' | 'antigravity' | 'codex' | 'claude';
export type SetupCandidate = { type: HarnessType; label: string; cli: { found: boolean; version?: string }; endpoint?: { url: string; reachable: boolean }; safeToSelect: boolean; supportsManagedServer?: boolean; auth?:{authenticated:boolean;kind:'api'|'cloud'|'subscription_oauth'|'none'|'unknown'};requiresConfirmation?:'claude_oauth';warning?: string };
export type SetupInstance = { id: string; type: HarnessType; enabled: boolean; endpoint?: string; managed?: boolean; permissionMode?: 'plan' | 'accept-edits';allowDangerFullAccess?:boolean;allowSubscriptionOAuth?:boolean };
export type SetupState = { completed: boolean; firstRoomId?: string; candidates: SetupCandidate[]; instances: Array<{ id: string; type: string; status: string; managed?: boolean;allowDangerFullAccess?:boolean;allowSubscriptionOAuth?:boolean }> };

export async function runSetup(config: SupervisorConfig, cliPath: string, options: { all?: boolean; openBrowser?: boolean } = {}) {
  await startSupervisor(config, cliPath);
  const state = await getSetupState(config);
  if (state.completed) {
    const url = webUrl(config, '/settings/harnesses');
    if (options.openBrowser !== false) openWebUi(config, '/settings/harnesses');
    return { completed: true, selected: [], url };
  }
  const safe = state.candidates.filter(candidate => candidate.safeToSelect && !candidate.requiresConfirmation);
  process.stdout.write(`${state.candidates.map(candidate => `${candidate.safeToSelect ? '[x]' : '[ ]'} ${candidate.label}: ${candidate.endpoint?.reachable ? 'endpoint ready' : candidate.cli.found ? candidate.cli.version ?? 'CLI found' : 'not detected'}`).join('\n')}\n`);
  let selected = safe;
  if (!options.all && process.stdin.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { if (/^n/i.test((await prompt.question('Use all safe detected connectors? [Y/n] ')).trim())) selected = []; }
    finally { prompt.close(); }
  }
  const instances = mergeConnectorSelection(state, selected.filter(candidate => candidate.type !== 'antigravity').map(candidate => candidate.type), false);
  await configureConnectors(config, instances);
  if (options.openBrowser !== false) openWebUi(config, '/setup');
  return { completed: false, selected: instances.filter(item => item.enabled).map(item => item.id), url: webUrl(config, '/setup') };
}

export async function getSetupState(config: SupervisorConfig) { return json<SetupState>(webUrl(config, '/api/v1/setup')); }
export async function configureConnectors(config: SupervisorConfig, instances: SetupInstance[]) {
  return json(webUrl(config, '/api/v1/setup/harnesses'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instances }) });
}

export function mergeConnectorSelection(state: SetupState, selected: HarnessType[], agyConfirmed: boolean,claudeOAuthConfirmed=false): SetupInstance[] {
  return state.candidates.filter(candidate => candidate.safeToSelect).map(candidate => {
    const enabled = selected.includes(candidate.type);
    const current = state.instances.find(instance => instance.type === candidate.type);
    return {
      id: current?.id ?? `local-${candidate.type}`,
      type: candidate.type,
      enabled,
      ...(candidate.endpoint ? { endpoint: candidate.endpoint.url } : {}),
      ...(candidate.type === 'opencode' ? { managed: current?.managed ?? true } : {}),
      ...(candidate.type === 'antigravity' && enabled && agyConfirmed ? { permissionMode: 'plan' as const } : {}),
      ...(candidate.type === 'codex'?{allowDangerFullAccess:current?.allowDangerFullAccess??false}:{}),
      ...(candidate.type === 'claude'?{allowSubscriptionOAuth:candidate.requiresConfirmation==='claude_oauth'&&enabled?(current?.allowSubscriptionOAuth===true||claudeOAuthConfirmed):false}:{}),
    };
  });
}

export function selectSafeInstances(candidates: SetupCandidate[]) {
  const state: SetupState = { completed: false, candidates, instances: [] };
  return mergeConnectorSelection(state, candidates.filter(candidate => candidate.safeToSelect && candidate.type !== 'antigravity'&&!candidate.requiresConfirmation).map(candidate => candidate.type), false).filter(item => item.enabled);
}
function webUrl(config: SupervisorConfig, path: string) { return `http://127.0.0.1:${config.corePort}${path}`; }
async function json<T = unknown>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error(`Setup API returned HTTP ${response.status}`); return response.json() as Promise<T>; }
