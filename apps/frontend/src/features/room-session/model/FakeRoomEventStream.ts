import type { Message } from '../../../entities/message';
import type { RoomEvent } from '../../../entities/room';
import type { AgentHandle, Run, RunStatus } from '../../../entities/run';
import type { RoomEventStream } from '../../../shared/api/realtime';

export type FakeEventScenario = 'parallel' | 'failure' | 'approval' | 'clarification' | 'reconnect';
const fakeAuthor={profileId:'local-user',displayName:'User',handle:'user'};

export class FakeRoomEventStream implements RoomEventStream<RoomEvent> {
  private listeners = new Set<(event: RoomEvent) => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private active = new Set<string>();
  private sequence = 0;
  private counter = 0;

  subscribe(listener: (event: RoomEvent) => void) {
    this.listeners.add(listener);
    listener({id:`evt-${++this.counter}`,sequence:this.sequence,type:'connection.changed',payload:{status:'connected'}});
    return () => { this.listeners.delete(listener); };
  }
  private emit(event: Omit<RoomEvent, 'id' | 'sequence'>) { const full = { ...event, id: `evt-${++this.counter}`, sequence: ++this.sequence } as RoomEvent; this.listeners.forEach((listener) => listener(full)); }
  private later(ms: number, callback: () => void) { const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, ms); this.timers.add(timer); }
  private run(messageId: string, agent: AgentHandle) { const id = `run-${++this.counter}-${agent}`; const run: Run = { id, messageId, agent, harnessInstanceId:'local-hermes',harnessType:'hermes',modelId:'fake',modeId:null,status: 'queued', text: '', tools: [] }; this.active.add(id); this.emit({ type: 'run.created', payload: run }); return id; }
  private status(runId: string, status: RunStatus, error?: string) { if (!this.active.has(runId) && status !== 'cancelled') return; if (['completed','failed','cancelled'].includes(status)) this.active.delete(runId); this.emit({ type: 'run.status', payload: { runId, status, error } }); }

  async send(text: string, targets: AgentHandle[]) {
    const id = `msg-${++this.counter}`; const runIds = targets.map((agent) => this.run(id, agent));
    const message: Message = { id, text, targets, runIds, createdAt: new Date().toISOString(),author:fakeAuthor,addressedToAll:false };
    this.emit({ type: 'message.created', payload: message });
    runIds.forEach((runId, index) => { this.later(160 + index * 90, () => this.status(runId, 'streaming')); this.later(360 + index * 110, () => this.emit({ type: 'run.delta', payload: { runId, text: ['Reviewing the task and context. ', 'Proposing a safe, verifiable approach. ', 'Done: the key decisions and next steps are ready.'][index % 3] } })); this.later(900 + index * 170, () => this.status(runId, 'completed')); });
    return message;
  }
  demo(kind: FakeEventScenario) {
    if (kind === 'parallel') { void this.send('@architect @coder Design a resilient real-time connection.', ['architect','coder']); return; }
    const text = `Demo: ${kind}`; const messageId = `msg-${++this.counter}`; const agent: AgentHandle = kind === 'failure' ? 'debugger' : kind === 'clarification' ? 'reviewer' : 'coder'; const runId = this.run(messageId, agent);
    this.emit({ type: 'message.created', payload: { id: messageId, text, targets: [agent], runIds: [runId], createdAt: new Date().toISOString(),author:fakeAuthor,addressedToAll:false } }); this.status(runId, 'streaming');
    if (kind === 'failure') { this.emit({ type: 'run.delta', payload: { runId, text: 'Checking the environment…' } }); this.later(350, () => this.status(runId, 'failed', 'Tool process exited with code 1')); }
    if (kind === 'approval') { this.emit({ type: 'tool.updated', payload: { runId, tool: { id: 'tool-write', name: 'write_file', detail: 'src/ws-manager.ts', status: 'progress' } } }); this.later(250, () => this.emit({ type: 'request.created', payload: { runId, kind: 'approval', prompt: 'Allow writing src/ws-manager.ts in the isolated workspace?' } })); }
    if (kind === 'clarification') this.later(250, () => this.emit({ type: 'request.created', payload: { runId, kind: 'clarification', prompt: 'Which reconnect strategy should be used: fixed delay or exponential backoff?' } }));
    if (kind === 'reconnect') { this.emit({ type: 'run.delta', payload: { runId, text: 'Received text before the connection dropped. ' } }); this.emit({ type: 'connection.changed', payload: { status: 'reconnecting' } }); this.later(500, () => this.emit({ type: 'connection.changed', payload: { status: 'replaying' } })); this.later(900, () => { this.emit({ type: 'connection.changed', payload: { status: 'connected' } }); this.emit({ type: 'run.delta', payload: { runId, text: 'Replay resumed the stream without duplicates.' } }); this.status(runId, 'completed'); }); }
  }
  resolve(runId: string, value: string) { this.emit({ type: 'request.resolved', payload: { runId, resolution: value } }); this.later(350, () => { this.emit({ type: 'run.delta', payload: { runId, text: ` Decision recorded: ${value}.` } }); this.status(runId, 'completed'); }); }
  cancel(runId?: string) { (runId ? [runId] : [...this.active]).forEach((id) => this.status(id, 'cancelled')); }
  dispose() { this.timers.forEach(clearTimeout); this.timers.clear(); this.listeners.clear(); }
}
