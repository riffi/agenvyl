import { AppError } from './AppError.js';
import { UpstreamError } from './UpstreamError.js';

export function mapUpstreamError(error: unknown) {
  const statusCode = error instanceof UpstreamError && error.status >= 400 && error.status < 500
    ? error.status
    : 502;
  return new AppError(
    'upstream_error',
    statusCode,
    error instanceof Error ? error.message : String(error),
  );
}
