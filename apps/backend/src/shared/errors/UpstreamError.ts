export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}
