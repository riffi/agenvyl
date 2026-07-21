export type ManagedComponent = 'postgresql' | 'connector' | 'core';
export type RuntimePhase = 'starting' | 'running' | 'stopping' | 'failed';

export type ComponentState = {
  pid: number;
  startedAt: string;
  logFile: string;
};

export type RuntimeState = {
  schemaVersion: 1;
  daemonPid: number;
  phase: RuntimePhase;
  startedAt: string;
  updatedAt: string;
  managedPostgres: boolean;
  ports: { postgresql: number; connector: number; core: number };
  components: Partial<Record<ManagedComponent, ComponentState>>;
  failure?: { component?: ManagedComponent; message: string };
};

export type RuntimeStatus = {
  running: boolean;
  stale: boolean;
  state?: RuntimeState;
  health: Partial<Record<ManagedComponent, 'ready' | 'not_ready' | 'stopped'>>;
};
