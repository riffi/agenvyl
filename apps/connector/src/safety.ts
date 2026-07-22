import type { ConnectorError, ConnectorRequestSnapshot } from '@agenvyl/connector-contract';
import type { AdapterExecutionEvent } from './adapter.js';

const REDACTED = '[REDACTED]';
const PATH_REDACTED = '[ABSOLUTE_PATH]';

export function redactConnectorText(value: string, maxLength = 2_000) {
  const scanLimit = Math.max(4_096, maxLength * 4);
  let safe = value.slice(0, scanLimit)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi, REDACTED)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk-|gh[oprsu]_|github_pat_|xox[aboprs]-)[-A-Za-z0-9_]{8,}\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/((?:["']?)(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|secret|token|cookie)(?:["']?)\s*:\s*)(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\2/gi, `$1$2${REDACTED}$2`)
    .replace(/\b((?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|secret|token)\s*[:=]\s*)(["']?)([^\s,"';}]+)\2/gi, `$1${REDACTED}`)
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)\s*=\s*)(["']?)([^\s"']+)\2/g, `$1${REDACTED}`)
    .replace(/\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/(^|[\s('"=])\/(?:[^\s/'"]+\/)*[^\s'",)]*/g, `$1${PATH_REDACTED}`)
    .replace(/\b[A-Za-z]:[\\/](?:[^\s\\/'"(),]+[\\/])*[^\s\\/'"(),]*/g, PATH_REDACTED)
    .trim();
  if (!safe) return '';
  if (safe.length > maxLength) safe = `${safe.slice(0, Math.max(0, maxLength - 1))}…`;
  return safe;
}

export function safeAdapterError(error: unknown, fallbackCode: string): ConnectorError {
  const fallbackMessage = fallbackCode === 'adapter_stop_failed' ? 'Adapter stop failed' : 'Adapter execution failed';
  if (!(error instanceof Error)) return { code: fallbackCode, message: fallbackMessage };
  return { code: fallbackCode, message: redactConnectorText(error.message, 500) || fallbackMessage };
}

export function sanitizeAdapterEvent(event: AdapterExecutionEvent): AdapterExecutionEvent {
  switch (event.type) {
    case 'tool.started':
    case 'tool.updated':
    case 'tool.completed':
      return {
        type: event.type,
        payload: {
          toolId: safeIdentifier(event.payload.toolId, 'tool'),
          name: redactConnectorText(event.payload.name, 128) || 'tool',
          safeSummary: redactConnectorText(event.payload.safeSummary),
          ...(event.payload.safeInput === undefined ? {} : { safeInput: redactConnectorText(event.payload.safeInput, 8_000) }),
        },
      };
    case 'request.opened':
      return { type: event.type, payload: { request: sanitizeRequest(event.payload.request) } };
    case 'request.resolved':
      return { type: event.type, payload: { requestId: safeIdentifier(event.payload.requestId, 'request'), outcome: event.payload.outcome } };
    case 'execution.failed':
      return {
        type: event.type,
        payload: {
          error: {
            code: safeErrorCode(event.payload.error.code),
            message: redactConnectorText(event.payload.error.message, 500) || 'Adapter execution failed',
          },
        },
      };
    case 'execution.upstream_status':
      return {
        type: event.type,
        payload: {
          state: event.payload.state,
          reason: event.payload.reason,
          retryable: event.payload.retryable,
          ...(!Number.isSafeInteger(event.payload.attempt) || Number(event.payload.attempt) < 0 ? {} : { attempt: event.payload.attempt }),
          ...(event.payload.retryAt === undefined || !Number.isFinite(Date.parse(event.payload.retryAt)) ? {} : { retryAt: new Date(event.payload.retryAt).toISOString() }),
          ...(event.payload.message === undefined ? {} : { message: redactConnectorText(event.payload.message, 500) || 'Upstream provider is temporarily unavailable' }),
        },
      };
    default:
      return structuredClone(event);
  }
}

function sanitizeRequest(request: ConnectorRequestSnapshot): ConnectorRequestSnapshot {
  return {
    id: safeIdentifier(request.id, 'request'),
    kind: request.kind,
    prompt: redactConnectorText(request.prompt) || 'Upstream requests user input',
    ...(request.choices ? { choices: request.choices.slice(0, 32).map(choice => redactConnectorText(choice, 200)).filter(Boolean) } : {}),
    ...(request.questions ? { questions: request.questions.slice(0,3).map(question=>({id:safeIdentifier(question.id,'question'),header:redactConnectorText(question.header,128)||'Question',question:redactConnectorText(question.question,2_000)||'Codex requests input',isOther:question.isOther,isSecret:question.isSecret,...(question.options?{options:question.options.slice(0,10).map(option=>({label:redactConnectorText(option.label,300)||'Option',...(option.description?{description:redactConnectorText(option.description,500)}:{})}))}:{})})) } : {}),
    ...(request.autoResolutionMs===undefined?{}:{autoResolutionMs:request.autoResolutionMs}),
    ...(request.resolution ? { resolution: { outcome: request.resolution.outcome, ...(request.resolution.value === undefined ? {} : { value: redactConnectorText(request.resolution.value, 2_000) }) } } : {}),
  };
}

function safeIdentifier(value: string, fallback: string) {
  const safe = redactConnectorText(value, 256);
  return safe || fallback;
}

function safeErrorCode(value: string) {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : 'adapter_execution_failed';
}
