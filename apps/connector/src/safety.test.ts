import { describe, expect, it } from 'vitest';
import { redactConnectorText, safeAdapterError, sanitizeAdapterEvent } from './safety.js';

describe('Connector safety boundary', () => {
  it('redacts common credentials, URL auth, host paths, controls, and oversized values', () => {
    const secrets = [
      ['sk', 'abcdefghijklmnopqrstuvwxyz123456'].join('-'),
      ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_'),
      'eyJabcdefghijk.abcdefghijk.abcdefghijk',
      'password=hunter2',
      'AGENVYL_CONNECTOR_TOKEN=connector-secret-value',
      'https://alice:supersecret@example.test/path',
      '/home/alice/private/file.txt',
      'C:\\Users\\Vladimir\\secret.txt',
    ];
    const safe = redactConnectorText(`Bearer bearer-token-value ${secrets.join(' ')}\u0000 ${'x'.repeat(3_000)}`);
    for (const secret of secrets) expect(safe).not.toContain(secret);
    expect(safe).not.toContain('bearer-token-value');
    expect(safe).toContain('[REDACTED]');
    expect(safe).toContain('[ABSOLUTE_PATH]');
    expect(safe).toHaveLength(2_000);
    expect(safe.endsWith('…')).toBe(true);
  });

  it('sanitizes every adapter-controlled summary before registry persistence', () => {
    const tool = sanitizeAdapterEvent({
      type: 'tool.updated',
      payload: { toolId: 'tool-1', name: 'shell', safeSummary: 'token=secret-value at /srv/private/result.txt', safeInput: '{"password":"secret-value","path":"/srv/private/input.txt"}' },
    });
    expect(tool).toEqual({
      type: 'tool.updated',
      payload: { toolId: 'tool-1', name: 'shell', safeSummary: 'token=[REDACTED] at [ABSOLUTE_PATH]', safeInput: '{"password":"[REDACTED]","path":"[ABSOLUTE_PATH]"}' },
    });

    const request = sanitizeAdapterEvent({
      type: 'request.opened',
      payload: { request: { id: 'request-1', kind: 'clarification', prompt: `API_KEY=secret ${'p'.repeat(3_000)}`, choices: Array.from({ length: 40 }, (_, index) => `choice-${index}`) } },
    });
    expect(request.type).toBe('request.opened');
    if (request.type !== 'request.opened') throw new Error('Expected request event');
    expect(request.payload.request.prompt).not.toContain('secret');
    expect(request.payload.request.prompt.length).toBe(2_000);
    expect(request.payload.request.choices).toHaveLength(32);

    expect(sanitizeAdapterEvent({ type: 'execution.failed', payload: { error: { code: 'INVALID CODE', message: 'Bearer secret-token-value' } } })).toEqual({
      type: 'execution.failed', payload: { error: { code: 'adapter_execution_failed', message: 'Bearer [REDACTED]' } },
    });
    expect(sanitizeAdapterEvent({type:'execution.upstream_status',payload:{state:'retrying',reason:'provider_unavailable',retryable:true,message:'token=secret-value /srv/private/body.json'}})).toEqual({
      type:'execution.upstream_status',payload:{state:'retrying',reason:'provider_unavailable',retryable:true,message:'token=[REDACTED] [ABSOLUTE_PATH]'},
    });
  });

  it('turns thrown adapter errors into bounded safe errors', () => {
    const safe = safeAdapterError(new Error(`failed with password=secret at /home/private/file ${'x'.repeat(1_000)}`), 'adapter_execution_failed');
    expect(safe.code).toBe('adapter_execution_failed');
    expect(safe.message).not.toContain('secret');
    expect(safe.message).not.toContain('/home/private');
    expect(safe.message.length).toBe(500);
    expect(safeAdapterError('raw secret', 'adapter_stop_failed')).toEqual({ code: 'adapter_stop_failed', message: 'Adapter stop failed' });
  });
});
