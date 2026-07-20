import { ApiError } from './ApiError';
import type { ErrorEnvelope } from '@agenvyl/contracts';

export type ApiRequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

export async function apiRequest<T = void>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, headers, ...init } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiError(0, 'network_error', cause instanceof Error ? cause.message : 'Network request failed', undefined, { cause });
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (cause) {
      if (response.ok) throw new ApiError(response.status, 'invalid_response', 'Server returned invalid JSON', { body: text }, { cause });
    }
  }

  if (!response.ok) {
    const payload = data && typeof data === 'object' ? data as Partial<ErrorEnvelope> : undefined;
    const code = typeof payload?.error === 'string' ? payload.error : 'request_failed';
    const message = typeof payload?.message === 'string' ? payload.message : typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
    throw new ApiError(response.status, code, message, data ?? (text ? { body: text } : undefined));
  }
  if (!text) return undefined as T;
  return data as T;
}
