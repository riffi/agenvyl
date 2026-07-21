export class SupervisorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly action?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SupervisorError';
  }
}

export function errorEnvelope(error: unknown) {
  if (error instanceof SupervisorError) {
    return { error: { code: error.code, message: error.message, ...(error.action ? { action: error.action } : {}), ...(error.details ? { details: error.details } : {}) } };
  }
  return { error: { code: 'UNEXPECTED_ERROR', message: error instanceof Error ? error.message : String(error) } };
}
