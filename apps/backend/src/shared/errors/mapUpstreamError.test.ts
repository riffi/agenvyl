import { describe, expect, it } from 'vitest';
import { UpstreamError } from './UpstreamError.js';
import { mapUpstreamError } from './mapUpstreamError.js';

describe('mapUpstreamError', () => {
  it('preserves actionable upstream client statuses without depending on a vendor name', () => {
    const mapped = mapUpstreamError(new UpstreamError('opencode', 409, 'Session is busy'));

    expect(mapped).toMatchObject({ code: 'upstream_error', statusCode: 409, message: 'Session is busy' });
  });

  it('maps transport and server failures to bad gateway', () => {
    const mapped = mapUpstreamError(new Error('Connector offline'));

    expect(mapped).toMatchObject({ code: 'upstream_error', statusCode: 502, message: 'Connector offline' });
  });
});
