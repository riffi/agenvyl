import type { ConnectorAdapter } from './adapter.js';
import type { ConnectorInstanceConfig } from './config.js';

export type PreparedAdapterRuntime = {
  adapters: ReadonlyMap<string, ConnectorAdapter>;
  release?: () => Promise<void> | void;
};

export type AdapterGenerationBinding = {
  adapter: ConnectorAdapter;
  harnessType: string;
  adapterGeneration: number;
  release: () => void;
};

type GenerationState = 'candidate' | 'current' | 'draining' | 'retired';
export type AdapterGenerationCandidate = PreparedAdapterRuntime & {
  id: number;
  instances: ConnectorInstanceConfig[];
  instanceTypes: Map<string, string>;
  activeExecutions: number;
  state: GenerationState;
  retirement?: Promise<void>;
};

type GenerationLogger = {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
};

export class AdapterGenerationManager {
  private readonly generations = new Map<number, AdapterGenerationCandidate>();
  private currentGeneration: AdapterGenerationCandidate;
  private closed = false;

  constructor(
    instances: ConnectorInstanceConfig[],
    runtime: PreparedAdapterRuntime,
    private readonly logger?: GenerationLogger,
  ) {
    this.currentGeneration = this.generation(1, instances, runtime, 'current');
    this.generations.set(1, this.currentGeneration);
    this.logCreated(this.currentGeneration);
  }

  get current() {
    return this.currentGeneration;
  }

  matchesCurrent(instances: ConnectorInstanceConfig[]) {
    return JSON.stringify(this.currentGeneration.instances) === JSON.stringify(instances);
  }

  candidate(instances: ConnectorInstanceConfig[], runtime: PreparedAdapterRuntime) {
    if (this.closed) throw new Error('Adapter generations are closed');
    return this.generation(this.currentGeneration.id + 1, instances, runtime, 'candidate');
  }

  activate(candidate: AdapterGenerationCandidate) {
    if (candidate.state !== 'candidate') throw new Error('Adapter generation candidate is not activatable');
    const previous = this.currentGeneration;
    candidate.state = 'current';
    this.currentGeneration = candidate;
    this.generations.set(candidate.id, candidate);
    previous.state = 'draining';
    this.logCreated(candidate);
    this.logger?.info({
      adapterGeneration: previous.id,
      activeExecutions: previous.activeExecutions,
    }, 'Connector adapter generation is draining');
    if (previous.activeExecutions === 0) void this.retire(previous);
  }

  async discard(candidate: AdapterGenerationCandidate) {
    if (candidate.state !== 'candidate') return;
    candidate.state = 'retired';
    await this.closeRuntime(candidate);
  }

  acquire(instanceId: string): AdapterGenerationBinding {
    const generation = this.currentGeneration;
    const harnessType = generation.instanceTypes.get(instanceId);
    if (!harnessType) throw new AdapterGenerationError('instance_not_found', 'Connector instance not found', 404);
    const adapter = generation.adapters.get(instanceId);
    if (!adapter) throw new AdapterGenerationError('instance_unavailable', 'Connector instance adapter is not loaded', 503);
    if (adapter.type !== harnessType) throw new AdapterGenerationError('adapter_type_mismatch', 'Connector adapter type does not match instance configuration', 500);
    generation.activeExecutions += 1;
    let released = false;
    return {
      adapter,
      harnessType,
      adapterGeneration: generation.id,
      release: () => {
        if (released) return;
        released = true;
        generation.activeExecutions -= 1;
        if (generation.state === 'draining' && generation.activeExecutions === 0) void this.retire(generation);
      },
    };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    const generations = [...this.generations.values()];
    await Promise.allSettled(generations.map(generation => this.retire(generation)));
  }

  private generation(id: number, instances: ConnectorInstanceConfig[], runtime: PreparedAdapterRuntime, state: GenerationState): AdapterGenerationCandidate {
    const enabled = instances.filter(instance => instance.enabled);
    return {
      id,
      instances: structuredClone(instances),
      instanceTypes: new Map(enabled.map(instance => [instance.id, instance.type])),
      adapters: new Map(runtime.adapters),
      release: runtime.release,
      activeExecutions: 0,
      state,
    };
  }

  private retire(generation: AdapterGenerationCandidate) {
    if (generation.retirement) return generation.retirement;
    generation.state = 'retired';
    generation.retirement = this.closeRuntime(generation).then(() => {
      this.generations.delete(generation.id);
      this.logger?.info({ adapterGeneration: generation.id }, 'Connector adapter generation retired');
    });
    return generation.retirement;
  }

  private async closeRuntime(generation: AdapterGenerationCandidate) {
    const adapters = [...new Set(generation.adapters.values())].filter(adapter => !this.adapterUsedByLiveGeneration(adapter, generation));
    const operations = [
      ...adapters.map(adapter => () => adapter.close?.()),
      ...(generation.release ? [() => generation.release?.()] : []),
    ];
    const results = await Promise.allSettled(operations.map(operation => Promise.resolve().then(operation)));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) this.logger?.warn({ adapterGeneration: generation.id, failures: failures.length }, 'Connector adapter generation retirement had cleanup failures');
  }

  private adapterUsedByLiveGeneration(adapter: ConnectorAdapter, excluded: AdapterGenerationCandidate) {
    return [...this.generations.values()].some(generation => generation !== excluded && generation.state !== 'retired' && [...generation.adapters.values()].includes(adapter));
  }

  private logCreated(generation: AdapterGenerationCandidate) {
    this.logger?.info({
      adapterGeneration: generation.id,
      instanceCount: generation.instanceTypes.size,
    }, 'Connector adapter generation activated');
  }
}

export class AdapterGenerationError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message);
  }
}
