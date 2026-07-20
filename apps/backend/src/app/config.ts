export type AppConfig = {
  databaseUrl: string;
  connectorUrl: string;
  connectorToken: string;
  distPath: string;
  runConcurrency: number;
  runTimeoutMs: number;
  shutdownTimeoutMs: number;
  websocketMaxBufferedBytes: number;
  workspaceRoot: string;
  workspaceAgentRoot: string;
  workspaceMaxFileBytes: number;
};

export type AppConfigOverrides = Partial<AppConfig>;

export function resolveAppConfig(overrides: AppConfigOverrides = {}): AppConfig {
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
    runConcurrency: positiveInteger(overrides.runConcurrency ?? process.env.AGENVYL_RUN_CONCURRENCY, 4),
    runTimeoutMs: positiveInteger(overrides.runTimeoutMs ?? process.env.AGENVYL_RUN_TIMEOUT_MS, 15*60_000),
    shutdownTimeoutMs: positiveInteger(overrides.shutdownTimeoutMs ?? process.env.AGENVYL_SHUTDOWN_TIMEOUT_MS, 10_000),
    websocketMaxBufferedBytes: positiveInteger(overrides.websocketMaxBufferedBytes ?? process.env.AGENVYL_WEBSOCKET_MAX_BUFFERED_BYTES, 1_048_576),
    workspaceRoot: overrides.workspaceRoot ?? process.env.AGENVYL_WORKSPACE_ROOT ?? 'data/room-workspaces',
    workspaceAgentRoot: overrides.workspaceAgentRoot ?? process.env.AGENVYL_WORKSPACE_AGENT_ROOT ?? overrides.workspaceRoot ?? process.env.AGENVYL_WORKSPACE_ROOT ?? 'data/room-workspaces',
    workspaceMaxFileBytes: positiveInteger(overrides.workspaceMaxFileBytes ?? process.env.AGENVYL_WORKSPACE_MAX_FILE_BYTES, 50*1024*1024),
  };
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>0?parsed:fallback;
}
