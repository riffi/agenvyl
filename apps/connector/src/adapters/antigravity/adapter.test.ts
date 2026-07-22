import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterStartExecutionRequest } from '../../adapter.js';
import { AntigravityConnectorAdapter, antigravityPrompt, shouldDetachAntigravityProcess } from './adapter.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe('AntigravityConnectorAdapter', () => {
  it('keeps AGY in the hidden parent console on Windows and creates a process group on POSIX', () => {
    expect(shouldDetachAntigravityProcess('win32')).toBe(false);
    expect(shouldDetachAntigravityProcess('linux')).toBe(true);
    expect(shouldDetachAntigravityProcess('darwin')).toBe(true);
  });

  it('discovers exact models and exposes the instance permission ceiling', async () => {
    const fixture = await fakeAgy();
    const adapter = fixture.adapter({ env: { FAKE_AGY_VERSION: '1.1.3', FAKE_AGY_MODELS: 'Gemini 3.5 Flash (High)\nClaude Sonnet 4.6 (Thinking)\nGemini 3.5 Flash (High)\n' } });
    await expect(adapter.catalog()).resolves.toEqual({
      models: [
        { id: 'Gemini 3.5 Flash (High)', label: 'Gemini 3.5 Flash (High)' },
        { id: 'Claude Sonnet 4.6 (Thinking)', label: 'Claude Sonnet 4.6 (Thinking)' },
      ],
      controls:{nativeWorkflowModes:['plan'],permissionProfiles:[{id:'plan',label:'Plan-only instance'}],agentVariants:[]},
    });
    const old = fixture.adapter({ env: { FAKE_AGY_VERSION: '1.1.2' } });
    await expect(old.catalog()).rejects.toThrow('1.1.3 or newer');
  });

  it('serializes version and model probes and shares concurrent catalog requests',async()=>{
    const fixture=await fakeAgy();
    const adapter=fixture.adapter({env:{FAKE_AGY_LOCK:join(fixture.directory,'agy.lock'),FAKE_AGY_MODELS:'gemini\n'}});
    const [first,second]=await Promise.all([adapter.catalog(),adapter.catalog()]);
    expect(first).toBe(second);
    expect(first.models).toEqual([{id:'gemini',label:'gemini'}]);
    await expect(adapter.catalog()).resolves.toBe(first);
  });

  it('runs one fresh process with exact routing, cwd, auto-update guard and deterministic flattened context', async () => {
    const fixture = await fakeAgy();
    const capturePath = join(fixture.directory, 'capture.json');
    const adapter = fixture.adapter({ env: { FAKE_AGY_CAPTURE: capturePath, FAKE_AGY_OUTPUT: 'Final answer\n' }, printTimeoutMs: 42_000,permissionMode:'accept-edits' });
    const request = execution(fixture.directory);
    const handle = await adapter.start(request);
    expect(handle).toEqual({ upstreamId: request.executionId });
    await expect(collect(adapter.events(handle))).resolves.toEqual([
      { type: 'output.text.delta', payload: { text: 'Final answer' } },
      { type: 'execution.completed', payload: {} },
    ]);
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as { args: string[]; cwd: string; disableAutoUpdate?: string };
    expect(capture.cwd).toBe(fixture.directory);
    expect(capture.disableAutoUpdate).toBe('true');
    expect(capture.args.slice(0, 8)).toEqual(['--dangerously-skip-permissions', '--mode', 'accept-edits', '--model', 'Gemini 3.5 Flash (High)', '--print-timeout', '42000ms', '--print']);
    expect(capture.args[8]).toBe(antigravityPrompt(request));
    expect(JSON.parse(capture.args[8]!.split('\n')[1]!)).toMatchObject({ systemInstruction: 'Act as coder.', conversationHistory: [{ role: 'user', content: 'Earlier' }], currentUserMessage: 'Implement it.' });
  });

  it('fails closed for unsupported modes, oversized prompts, empty output and non-zero exits', async () => {
    const fixture = await fakeAgy();
    const adapter = fixture.adapter({ env: {}, maxPromptBytes: 300,permissionMode:'accept-edits' });
    await expect(adapter.start({ ...execution(fixture.directory), executionId: 'large', input: { systemPrompt: '', history: [], message: 'x'.repeat(400) } })).rejects.toThrow('argv boundary');

    const empty = fixture.adapter({ env: { FAKE_AGY_OUTPUT: '' },permissionMode:'accept-edits' });
    const emptyHandle = await empty.start({ ...execution(fixture.directory), executionId: 'empty' });
    await expect(collect(empty.events(emptyHandle))).resolves.toEqual([{ type: 'execution.failed', payload: { error: { code: 'agy_empty_output', message: expect.any(String) } } }]);

    const failed = fixture.adapter({ env: { FAKE_AGY_EXIT: '7', FAKE_AGY_STDERR: 'token=secret-value failed' },permissionMode:'accept-edits' });
    const failedHandle = await failed.start({ ...execution(fixture.directory), executionId: 'failed' });
    await expect(collect(failed.events(failedHandle))).resolves.toEqual([{ type: 'execution.failed', payload: { error: { code: 'agy_execution_failed', message: 'token=[REDACTED] failed' } } }]);
  });

  it('terminates a stubborn process tree and reports cancellation', async () => {
    const fixture = await fakeAgy();
    const capturePath = join(fixture.directory, 'capture.json');
    const adapter = fixture.adapter({ env: { FAKE_AGY_CAPTURE: capturePath, FAKE_AGY_BEHAVIOR: 'hang' }, stopGraceMs: 25,permissionMode:'accept-edits' });
    const handle = await adapter.start({ ...execution(fixture.directory), executionId: 'cancelled' });
    await waitForFile(capturePath);
    const eventsPromise = collect(adapter.events(handle));
    await adapter.stop(handle);
    await expect(eventsPromise).resolves.toEqual([{ type: 'execution.cancelled', payload: {} }]);
    await expect(adapter.inspect(handle)).rejects.toThrow('not active');
  });
});

function execution(workspace: string): AdapterStartExecutionRequest {
  return {
    executionId: 'run-agy-1', harnessInstanceId: 'local-antigravity', modelId: 'Gemini 3.5 Flash (High)', executionProfile:{workflowMode:'work',reasoningEffort:null,permissionProfileId:'accept-edits',agentVariantId:null,planEnforcement:null},
    workspace: { roomId: 'room-1', relativePath: '.', absolutePath: workspace },
    input: { systemPrompt: 'Act as coder.', history: [{ role: 'user', content: 'Earlier' }], message: 'Implement it.' },
  };
}

async function collect(source: AsyncIterable<unknown>) { const values: unknown[] = []; for await (const value of source) values.push(value); return values; }

async function fakeAgy() {
  const directory = await mkdtemp(join(tmpdir(), 'agenvyl-agy-'));
  directories.push(directory);
  const script = join(directory, 'agy.cjs');
  await writeFile(script, `
const { closeSync, openSync, unlinkSync, writeFileSync } = require('node:fs');
const args=process.argv.slice(2);
if(process.env.FAKE_AGY_LOCK){
  try{closeSync(openSync(process.env.FAKE_AGY_LOCK,'wx'))}catch{process.stderr.write('concurrent agy invocation');process.exit(9)}
  process.on('exit',()=>{try{unlinkSync(process.env.FAKE_AGY_LOCK)}catch{}});
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
}
if(args[0]==='--version'){console.log(process.env.FAKE_AGY_VERSION||'1.1.3');process.exit(0)}
if(args[0]==='models'){process.stdout.write(process.env.FAKE_AGY_MODELS||'Gemini 3.5 Flash (High)\\n');process.exit(0)}
if(process.env.FAKE_AGY_CAPTURE)writeFileSync(process.env.FAKE_AGY_CAPTURE,JSON.stringify({args,cwd:process.cwd(),disableAutoUpdate:process.env.AGY_CLI_DISABLE_AUTO_UPDATE,pid:process.pid}));
if(process.env.FAKE_AGY_BEHAVIOR==='hang'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000)}
else{if(process.env.FAKE_AGY_STDERR)process.stderr.write(process.env.FAKE_AGY_STDERR);process.stdout.write(process.env.FAKE_AGY_OUTPUT??'ok');process.exit(Number(process.env.FAKE_AGY_EXIT||0))}
`);
  return {
    directory,
    adapter: (options: Omit<import('./adapter.js').AntigravityAdapterOptions, 'command' | 'commandArgsPrefix'>) => new AntigravityConnectorAdapter({ ...options, command: process.execPath, commandArgsPrefix: [script] }),
  };
}

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await readFile(path); return; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  throw new Error('Timed out waiting for fake AGY process');
}
