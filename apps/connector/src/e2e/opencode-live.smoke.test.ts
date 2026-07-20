import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { OpenCodeConnectorAdapter } from '../adapters/opencode/adapter.js';

const url = requiredEnvironment('AGENVYL_CONNECTOR_OPENCODE_URL');
const modelId = requiredEnvironment('AGENVYL_LIVE_OPENCODE_MODEL');
const workspace = await mkdtemp(join(tmpdir(), 'agenvyl-opencode-live-'));
await writeFile(join(workspace, 'opencode.json'), JSON.stringify({ permission: { edit: 'allow', bash: 'ask' } }));

afterAll(async () => { await rm(workspace, { recursive: true, force: true }); });

describe('live OpenCode adapter', () => {
  it('discovers the selected model and completes one fresh text execution', async () => {
    const adapter = liveAdapter();
    const catalog = await adapter.catalog();
    expect(catalog.models.map(model => model.id)).toContain(modelId);
    const modeId = catalog.modes.some(mode => mode.id === 'build') ? 'build' : null;
    const execution = await adapter.start({
      executionId: crypto.randomUUID(), harnessInstanceId: 'local-opencode', modelId, modeId,
      workspace: { roomId: 'live-room', relativePath: '.', absolutePath: workspace },
      input: {
        systemPrompt: 'Follow the user instruction precisely. Do not call tools.',
        history: [{ role: 'user', content: 'This is a transport compatibility check.' }, { role: 'assistant', content: 'Understood.' }],
        message: 'Reply with exactly AGENVYL_OPENCODE_OK and nothing else.',
      },
    });
    const events = await collect(adapter.events(execution), 120_000);
    const text = events.filter(event => event.type === 'output.text.delta').map(event => event.payload.text).join('');
    expect(text).toContain('AGENVYL_OPENCODE_OK');
    const usage=events.filter(event=>event.type==='usage.updated').at(-1)?.payload.usage;
    expect(usage).toMatchObject({inputTokens:expect.any(Number),outputTokens:expect.any(Number)});
    expect(events.at(-1)).toEqual({ type: 'execution.completed', payload: {} });
  }, 130_000);

  it('streams a real workspace tool lifecycle without approval', async () => {
    const adapter = liveAdapter();
    const execution = await adapter.start(startRequest(
      'Use the file editing or writing tool, not bash, to create tool-smoke.txt containing exactly TOOL_SMOKE_OK. Then reply with exactly TOOL_SMOKE_OK.',
    ));
    const events = await collect(adapter.events(execution), 120_000);
    expect(events.some(event => event.type === 'tool.started' || event.type === 'tool.updated')).toBe(true);
    expect(events.some(event => event.type === 'tool.completed')).toBe(true);
    expect(await readFile(join(workspace, 'tool-smoke.txt'), 'utf8')).toBe('TOOL_SMOKE_OK');
    expect(events.at(-1)).toEqual({ type: 'execution.completed', payload: {} });
  }, 130_000);

  it('pauses for a real manual permission and resumes only after an explicit reply', async () => {
    const adapter = liveAdapter();
    const execution = await adapter.start(startRequest(
      "Use bash to run exactly: printf APPROVAL_SMOKE_OK > approval-smoke.txt. Do not use another tool. After it succeeds, reply with exactly APPROVAL_SMOKE_OK.",
    ));
    const events = [], source = adapter.events(execution);
    let approvalSeen = false;
    for await (const event of withTimeout(source, 120_000)) {
      events.push(event);
      if (event.type !== 'request.opened') continue;
      approvalSeen = true;
      expect(event.payload.request).toMatchObject({ kind: 'approval', choices: ['once', 'always', 'deny'] });
      await expect(adapter.resolveRequest(execution, event.payload.request, 'once')).resolves.toEqual({ outcome: 'answered' });
    }
    expect(approvalSeen).toBe(true);
    expect(events.some(event => event.type === 'tool.completed')).toBe(true);
    expect(await readFile(join(workspace, 'approval-smoke.txt'), 'utf8')).toBe('APPROVAL_SMOKE_OK');
    expect(events.at(-1)).toEqual({ type: 'execution.completed', payload: {} });
  }, 130_000);

  it('pauses for one real clarification and resumes only after an explicit answer', async () => {
    const adapter = liveAdapter();
    const execution = await adapter.start(startRequest(
      'Use the question tool to ask exactly one single-select question: "Which format should I use?" with options PNG and SVG and custom answers allowed. After the answer, reply with exactly CLARIFICATION_SMOKE_OK.',
    ));
    const events = [];
    let clarificationSeen = false;
    for await (const event of withTimeout(adapter.events(execution), 120_000)) {
      events.push(event);
      if (event.type !== 'request.opened' || event.payload.request.kind !== 'clarification') continue;
      clarificationSeen = true;
      expect(event.payload.request.prompt).toContain('Which format');
      await expect(adapter.resolveRequest(execution, event.payload.request, 'SVG')).resolves.toEqual({ outcome: 'answered' });
    }
    expect(clarificationSeen).toBe(true);
    const text = events.filter(event => event.type === 'output.text.delta').map(event => event.payload.text).join('');
    expect(text).toContain('CLARIFICATION_SMOKE_OK');
    expect(events.at(-1)).toEqual({ type: 'execution.completed', payload: {} });
  }, 130_000);

  it('aborts a real long-running tool after explicit permission', async () => {
    const adapter = liveAdapter();
    const execution = await adapter.start(startRequest(
      'Use bash to run exactly: sleep 60. Do not use another tool and do not answer before it finishes.',
    ));
    const iterator = adapter.events(execution)[Symbol.asyncIterator]();
    let approvalSeen = false, runningToolSeen = false;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && !runningToolSeen) {
      const next = await nextBefore(iterator, deadline - Date.now());
      if (next.done) throw new Error('OpenCode stream ended before the long-running tool started');
      if (next.value.type === 'request.opened') {
        approvalSeen = true;
        await adapter.resolveRequest(execution, next.value.payload.request, 'once');
      }
      if (next.value.type === 'tool.updated') runningToolSeen = true;
    }
    expect(approvalSeen).toBe(true);
    expect(runningToolSeen).toBe(true);
    await adapter.stop(execution);
    await expect(nextBefore(iterator, 5_000)).resolves.toEqual({ done: true, value: undefined });
  }, 130_000);
});

function liveAdapter() {
  return new OpenCodeConnectorAdapter({
    baseUrl: url,
    username: process.env.AGENVYL_CONNECTOR_OPENCODE_USERNAME,
    password: process.env.AGENVYL_CONNECTOR_OPENCODE_PASSWORD,
    catalogDirectory: workspace,
  });
}

function startRequest(message: string) {
  return {
    executionId: crypto.randomUUID(), harnessInstanceId: 'local-opencode', modelId, modeId: 'build',
    workspace: { roomId: 'live-room', relativePath: '.', absolutePath: workspace },
    input: { systemPrompt: 'Follow the user instruction precisely.', history: [], message },
  };
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the live OpenCode smoke`);
  return value;
}

async function collect<T>(source: AsyncIterable<T>, timeoutMs: number) {
  const values: T[] = [], timeout = AbortSignal.timeout(timeoutMs);
  const iterator = source[Symbol.asyncIterator]();
  while (true) {
    const next = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => timeout.addEventListener('abort', () => reject(new Error('OpenCode live smoke timed out')), { once: true })),
    ]);
    if (next.done) return values;
    values.push(next.value);
  }
}

async function* withTimeout<T>(source: AsyncIterable<T>, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs), iterator = source[Symbol.asyncIterator]();
  while (true) {
    const next = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => timeout.addEventListener('abort', () => reject(new Error('OpenCode live smoke timed out')), { once: true })),
    ]);
    if (next.done) return;
    yield next.value;
  }
}

async function nextBefore<T>(iterator: AsyncIterator<T>, timeoutMs: number) {
  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  return await Promise.race([
    iterator.next(),
    new Promise<never>((_, reject) => timeout.addEventListener('abort', () => reject(new Error('OpenCode live smoke timed out')), { once: true })),
  ]);
}
