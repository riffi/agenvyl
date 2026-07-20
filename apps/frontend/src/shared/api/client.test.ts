import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './ApiError';
import { apiRequest } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('serializes JSON and decodes a successful response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'room-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiRequest<{ id: string }>('/rooms', { method: 'POST', body: { title: 'Release' } })).resolves.toEqual({ id: 'room-1' });
    expect(fetchMock).toHaveBeenCalledWith('/rooms', expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: 'Release' }), headers: { 'content-type': 'application/json' } }));
  });

  it('returns undefined for 204 and empty successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 200 })));
    await expect(apiRequest('/empty-204')).resolves.toBeUndefined();
    await expect(apiRequest('/empty-200')).resolves.toBeUndefined();
  });

  it('normalizes API errors with details', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'room_busy', message: 'Room is busy', run_id: 'run-1' }), { status: 409 })));
    await expect(apiRequest('/rooms/1')).rejects.toEqual(expect.objectContaining<Partial<ApiError>>({ status: 409, code: 'room_busy', message: 'Room is busy', details: { error: 'room_busy', message: 'Room is busy', run_id: 'run-1' } }));
  });

  it('rejects invalid JSON from a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json', { status: 200 })));
    await expect(apiRequest('/broken')).rejects.toEqual(expect.objectContaining<Partial<ApiError>>({ status: 200, code: 'invalid_response' }));
  });

  it('normalizes network failures', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')));
    await expect(apiRequest('/offline')).rejects.toEqual(expect.objectContaining<Partial<ApiError>>({ status: 0, code: 'network_error', message: 'offline' }));
  });
});
