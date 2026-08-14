import { resolveAgenvylPaths } from '@agenvyl/runtime-config';

export type AppConfig = {
  databaseUrl: string;
  connectorUrl: string;
  connectorToken: string;
  distPath: string;
  serveStaticFrontend: boolean;
  runConcurrency: number;
  runTimeoutMs: number;
  shutdownTimeoutMs: number;
  websocketMaxBufferedBytes: number;
  workspaceRoot: string;
  workspaceAgentRoot: string;
  workspaceMaxFileBytes: number;
  artifactRoot:string;
  artifactMaxBytes:number;
  previewOrigin: string;
  conversationRouting: boolean;
};

export type AppConfigOverrides = Partial<AppConfig>;

export function resolveAppConfig(overrides: AppConfigOverrides = {}): AppConfig {
  const paths = resolveAgenvylPaths();
  const connectorUrl = overrides.connectorUrl ?? process.env.AGENVYL_CONNECTOR_URL;
  const connectorToken = overrides.connectorToken ?? process.env.AGENVYL_CONNECTOR_TOKEN;
  if(process.env.AGENVYL_EXECUTION_BACKEND!==undefined)throw new Error('AGENVYL_EXECUTION_BACKEND is no longer supported; Core always uses Connector');
  if (Boolean(connectorUrl) !== Boolean(connectorToken)) throw new Error('AGENVYL_CONNECTOR_URL and AGENVYL_CONNECTOR_TOKEN must be configured together');
  if(!connectorUrl||!connectorToken)throw new Error('Core requires AGENVYL_CONNECTOR_URL and AGENVYL_CONNECTOR_TOKEN');
  return {
    databaseUrl:
      overrides.databaseUrl ??
      process.env.AGENVYL_DATABASE_URL ??
      'postgres://agenvyl:agenvyl@127.0.0.1:5432/agenvyl',
    connectorUrl,
    connectorToken,
    distPath: overrides.distPath ?? 'apps/frontend/dist',
    serveStaticFrontend: overrides.serveStaticFrontend ?? booleanSetting(process.env.AGENVYL_SERVE_STATIC_FRONTEND, true, 'AGENVYL_SERVE_STATIC_FRONTEND'),
    runConcurrency: positiveInteger(overrides.runConcurrency ?? process.env.AGENVYL_RUN_CONCURRENCY, 4),
    runTimeoutMs: positiveInteger(overrides.runTimeoutMs ?? process.env.AGENVYL_RUN_TIMEOUT_MS, 15*60_000),
    shutdownTimeoutMs: positiveInteger(overrides.shutdownTimeoutMs ?? process.env.AGENVYL_SHUTDOWN_TIMEOUT_MS, 10_000),
    websocketMaxBufferedBytes: positiveInteger(overrides.websocketMaxBufferedBytes ?? process.env.AGENVYL_WEBSOCKET_MAX_BUFFERED_BYTES, 1_048_576),
    workspaceRoot: overrides.workspaceRoot ?? process.env.AGENVYL_WORKSPACE_ROOT ?? paths.workspaces,
    workspaceAgentRoot: overrides.workspaceAgentRoot ?? process.env.AGENVYL_WORKSPACE_AGENT_ROOT ?? overrides.workspaceRoot ?? process.env.AGENVYL_WORKSPACE_ROOT ?? paths.workspaces,
    workspaceMaxFileBytes: positiveInteger(overrides.workspaceMaxFileBytes ?? process.env.AGENVYL_WORKSPACE_MAX_FILE_BYTES, 50*1024*1024),
    artifactRoot:overrides.artifactRoot??process.env.AGENVYL_ARTIFACT_ROOT??paths.artifacts,
    artifactMaxBytes:positiveInteger(overrides.artifactMaxBytes??process.env.AGENVYL_ARTIFACT_MAX_BYTES,250*1024*1024),
    previewOrigin: overrides.previewOrigin ?? process.env.AGENVYL_PREVIEW_ORIGIN ?? `http://127.0.0.1:${positiveInteger(process.env.AGENVYL_PREVIEW_PORT,8792)}`,
    conversationRouting: overrides.conversationRouting ?? booleanSetting(process.env.AGENVYL_EXPERIMENT_CONVERSATION_ROUTING, false, 'AGENVYL_EXPERIMENT_CONVERSATION_ROUTING'),
  };
}

function booleanSetting(value:unknown,fallback:boolean,name:string){
  if(value===undefined)return fallback;
  if(value==='true')return true;
  if(value==='false')return false;
  throw new Error(`${name} must be true or false`);
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>0?parsed:fallback;
}
