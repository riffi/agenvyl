import type { RunContext } from '../../types.js';

export class ActiveRunRegistry {
  private readonly runs = new Map<string, RunContext>();

  add(run: RunContext) {
    this.runs.set(run.id, run);
  }

  get(runId: string) {
    return this.runs.get(runId);
  }

  remove(runId: string) {
    this.runs.delete(runId);
  }

  values() {
    return this.runs.values();
  }
}
