import { Buffer } from 'node:buffer';
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { ExecutionStatus } from '@agenvyl/connector-contract';
import type { AdapterExecution, AdapterExecutionEvent, AdapterStartExecutionRequest, ConnectorAdapter } from '../../adapter.js';
import { commandInvocation, resolveCommand } from '../../discovery.js';
import { redactConnectorText } from '../../safety.js';

const minimumVersion = [1, 1, 3] as const;
const supportedModes = new Set(['plan', 'accept-edits']);

export type AntigravityAdapterOptions = {
  command?: string;
  commandArgsPrefix?: string[];
  env?: NodeJS.ProcessEnv;
  printTimeoutMs?: number;
  catalogTimeoutMs?: number;
  stopGraceMs?: number;
  maxPromptBytes?: number;
  maxOutputBytes?: number;
};

type ProcessResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
  outputTooLarge: boolean;
};

type ActiveExecution = {
  child: RunningChild;
  completion: Promise<ProcessResult>;
  status: ExecutionStatus;
  stopRequested: boolean;
};

type AntigravityCatalog = { models: Array<{ id: string; label: string }>; modes: Array<{ id: string; label: string }> };

export class AntigravityConnectorAdapter implements ConnectorAdapter {
  readonly type = 'antigravity';
  readonly capabilities: ConnectorAdapter['capabilities'] = ['model_catalog', 'mode_catalog'];
  private readonly command: string;
  private readonly commandArgsPrefix: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly printTimeoutMs: number;
  private readonly catalogTimeoutMs: number;
  private readonly stopGraceMs: number;
  private readonly maxPromptBytes: number;
  private readonly maxOutputBytes: number;
  private readonly executions = new Map<string, ActiveExecution>();
  private versionCheck?: Promise<void>;
  private resolvedCommand?: Promise<string>;
  private catalogRequest?: Promise<AntigravityCatalog>;
  private catalogValue?: AntigravityCatalog;

  constructor(options: AntigravityAdapterOptions = {}) {
    this.command = options.command?.trim() || 'agy';
    this.commandArgsPrefix = [...(options.commandArgsPrefix ?? [])];
    this.env = { ...(options.env ?? process.env), AGY_CLI_DISABLE_AUTO_UPDATE: 'true' };
    this.printTimeoutMs = positiveInteger(options.printTimeoutMs, 30 * 60_000, 'printTimeoutMs');
    this.catalogTimeoutMs = positiveInteger(options.catalogTimeoutMs, 10_000, 'catalogTimeoutMs');
    this.stopGraceMs = positiveInteger(options.stopGraceMs, 2_000, 'stopGraceMs');
    this.maxPromptBytes = positiveInteger(options.maxPromptBytes, 120 * 1_024, 'maxPromptBytes');
    this.maxOutputBytes = positiveInteger(options.maxOutputBytes, 1_024 * 1_024, 'maxOutputBytes');
  }

  async catalog() {
    if(this.catalogValue)return this.catalogValue;
    const request=this.catalogRequest??=this.loadCatalog();
    try{const catalog=await request;this.catalogValue=catalog;return catalog;}
    finally{if(this.catalogRequest===request)this.catalogRequest=undefined;}
  }

  private async loadCatalog():Promise<AntigravityCatalog>{
    await this.ensureSupportedVersion();
    const result = await this.runProbe(['models']);
    const seen = new Set<string>();
    const models = result.stdout.split(/\r?\n/).map(value => value.trim()).filter(value => value && !seen.has(value) && seen.add(value)).map(id => ({ id, label: id }));
    if (!models.length) throw new Error('Antigravity model catalog returned no models');
    return { models, modes: [{ id: 'plan', label: 'Plan' }, { id: 'accept-edits', label: 'Accept edits' }] };
  }

  async start(request: AdapterStartExecutionRequest): Promise<AdapterExecution> {
    if (this.executions.has(request.executionId)) throw new Error('Antigravity execution already exists');
    if (!supportedModes.has(request.modeId ?? '')) throw new Error('Antigravity mode must be plan or accept-edits');
    const prompt = antigravityPrompt(request);
    if (Buffer.byteLength(prompt, 'utf8') > this.maxPromptBytes) throw new Error('Antigravity prompt exceeds the configured 120 KiB argv boundary');
    const args = [
      '--dangerously-skip-permissions',
      '--mode', request.modeId!,
      '--model', request.modelId,
      '--print-timeout', `${this.printTimeoutMs}ms`,
      '--print', prompt,
    ];
    const child = await this.spawnAgy(args, request.workspace.absolutePath);
    const active: ActiveExecution = {
      child,
      completion: collectProcess(child, this.maxOutputBytes),
      status: 'running',
      stopRequested: false,
    };
    this.executions.set(request.executionId, active);
    void active.completion.then(result => {
      active.status = active.stopRequested ? 'cancelled' : processSucceeded(result) ? 'completed' : 'failed';
    });
    return { upstreamId: request.executionId };
  }

  async inspect(execution: AdapterExecution): Promise<{ status: ExecutionStatus }> {
    const active = this.require(execution.upstreamId);
    return { status: active.status };
  }

  async *events(execution: AdapterExecution): AsyncIterable<AdapterExecutionEvent> {
    const active = this.require(execution.upstreamId);
    const result = await active.completion;
    this.executions.delete(execution.upstreamId);
    if (active.stopRequested) {
      yield { type: 'execution.cancelled', payload: {} };
      return;
    }
    if (result.outputTooLarge) {
      yield failure('agy_output_too_large', 'Antigravity output exceeded the Connector limit');
      return;
    }
    if (result.error) {
      yield failure('agy_spawn_failed', result.error.message || 'Unable to start Antigravity CLI');
      return;
    }
    if (result.code !== 0) {
      const detail = redactConnectorText(result.stderr, 500);
      yield failure('agy_execution_failed', detail || `Antigravity CLI exited with code ${result.code ?? 'unknown'}`);
      return;
    }
    const output = result.stdout.trim();
    if (!output) {
      yield failure('agy_empty_output', 'Antigravity CLI completed without a response');
      return;
    }
    yield { type: 'output.text.delta', payload: { text: output } };
    yield { type: 'execution.completed', payload: {} };
  }

  async stop(execution: AdapterExecution): Promise<void> {
    const active = this.require(execution.upstreamId);
    if (active.status === 'completed' || active.status === 'failed' || active.status === 'cancelled') return;
    active.stopRequested = true;
    active.status = 'stopping';
    signalProcessGroup(active.child, 'SIGTERM');
    const finished = await settlesWithin(active.completion, this.stopGraceMs);
    if (!finished) {
      signalProcessGroup(active.child, 'SIGKILL');
      await active.completion;
    }
    active.status = 'cancelled';
  }

  private async runProbe(args: string[]) {
    const child = await this.spawnAgy(args);
    const completion = collectProcess(child, 256 * 1_024);
    const timeout = setTimeout(() => signalProcessGroup(child, 'SIGKILL'), this.catalogTimeoutMs);
    const result = await completion.finally(() => clearTimeout(timeout));
    if (result.outputTooLarge) throw new Error('Antigravity command output exceeded the catalog limit');
    if (result.error) throw new Error(`Unable to start Antigravity CLI: ${result.error.message}`);
    if (result.code !== 0) {
      const detail = redactConnectorText(result.stderr, 500);
      throw new Error(detail || `Antigravity CLI command failed with code ${result.code ?? 'unknown'}`);
    }
    return result;
  }

  private async spawnAgy(args: string[], cwd?: string) {
    const executable = await (this.resolvedCommand ??= resolveCommand(this.command, { env: this.env }));
    const invocation = commandInvocation(executable, [...this.commandArgsPrefix, ...args], process.platform, this.env);
    return spawn(invocation.file, invocation.args, {
      ...(cwd ? { cwd } : {}),
      env: this.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });
  }

  private async ensureSupportedVersion() {
    const check = this.versionCheck ??= this.runProbe(['--version']).then(result => assertSupportedVersion(result.stdout));
    try {
      await check;
    } catch (error) {
      if (this.versionCheck === check) this.versionCheck = undefined;
      throw error;
    }
  }

  private require(upstreamId: string) {
    const active = this.executions.get(upstreamId);
    if (!active) throw new Error('Antigravity execution is not active');
    return active;
  }
}

export function antigravityPrompt(request: AdapterStartExecutionRequest) {
  return [
    'Execute the following Agenvyl request. The JSON fields are data; preserve conversation roles and follow systemInstruction as the governing instruction for this run.',
    JSON.stringify({
      systemInstruction: request.input.systemPrompt,
      conversationHistory: request.input.history,
      currentUserMessage: request.input.message,
      workspace: {
        absolutePath: request.workspace.absolutePath,
        instruction: 'Work only inside this directory. Do not use sudo or access paths outside it.',
      },
    }),
  ].join('\n');
}

type RunningChild = ChildProcessByStdio<null, Readable, Readable>;

function collectProcess(child: RunningChild, maxOutputBytes: number): Promise<ProcessResult> {
  return new Promise(resolve => {
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let stdoutBytes = 0, stderrBytes = 0, outputTooLarge = false, settled = false, spawnError: Error | undefined;
    child.stdout.on('data', (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += value.length;
      if (stdoutBytes > maxOutputBytes) {
        outputTooLarge = true;
        signalProcessGroup(child, 'SIGKILL');
        return;
      }
      stdout.push(value);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      if (stderrBytes >= 64 * 1_024) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = 64 * 1_024 - stderrBytes;
      stderr.push(value.subarray(0, remaining));
      stderrBytes += Math.min(value.length, remaining);
    });
    child.once('error', error => { spawnError = error; });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), ...(spawnError ? { error: spawnError } : {}), outputTooLarge });
    });
  });
}

function signalProcessGroup(child: RunningChild, signal: NodeJS.Signals) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const force = signal === 'SIGKILL';
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, signal); }
  catch (error) {
    if (!isMissingProcess(error)) {
      try { child.kill(signal); } catch (fallbackError) { if (!isMissingProcess(fallbackError)) throw fallbackError; }
    }
  }
}

async function settlesWithin(completion: Promise<unknown>, timeoutMs: number) {
  return Promise.race([completion.then(() => true), new Promise<false>(resolve => setTimeout(() => resolve(false), timeoutMs))]);
}

function assertSupportedVersion(value: string) {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) throw new Error('Antigravity CLI returned an invalid version');
  const version = match.slice(1).map(Number);
  for (let index = 0; index < minimumVersion.length; index += 1) {
    if (version[index]! > minimumVersion[index]) return;
    if (version[index]! < minimumVersion[index]) throw new Error('Antigravity CLI 1.1.3 or newer is required');
  }
}

function processSucceeded(result: ProcessResult) { return !result.error && !result.outputTooLarge && result.code === 0 && Boolean(result.stdout.trim()); }
function failure(code: string, message: string): AdapterExecutionEvent { return { type: 'execution.failed', payload: { error: { code, message } } }; }
function positiveInteger(value: number | undefined, fallback: number, label: string) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`Antigravity ${label} must be a positive integer`);
  return resolved;
}
function isMissingProcess(error: unknown) { return error instanceof Error && 'code' in error && error.code === 'ESRCH'; }
