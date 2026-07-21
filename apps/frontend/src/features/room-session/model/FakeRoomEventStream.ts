import type { Message } from '../../../entities/message';
import type { RoomEvent } from '../../../entities/room';
import type { AgentHandle, Run, RunStatus } from '../../../entities/run';
import type { RoomEventStream } from '../../../shared/api/realtime';

export type FakeEventScenario = 'parallel' | 'failure' | 'approval' | 'clarification' | 'reconnect';
const fakeAuthor={profileId:'local-user',displayName:'Пользователь',handle:'user'};

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
    runIds.forEach((runId, index) => { this.later(160 + index * 90, () => this.status(runId, 'streaming')); this.later(360 + index * 110, () => this.emit({ type: 'run.delta', payload: { runId, text: ['Разбираю задачу и контекст. ', 'Предлагаю безопасный, проверяемый вариант. ', 'Готово: ключевые решения и следующие шаги сформированы.'][index % 3] } })); this.later(900 + index * 170, () => this.status(runId, 'completed')); });
    return message;
  }
  demo(kind: FakeEventScenario) {
    if (kind === 'parallel') { void this.send('@architect @coder Спроектируйте устойчивое real-time соединение.', ['architect','coder']); return; }
    const text = `Демо: ${kind}`; const messageId = `msg-${++this.counter}`; const agent: AgentHandle = kind === 'failure' ? 'debugger' : kind === 'clarification' ? 'reviewer' : 'coder'; const runId = this.run(messageId, agent);
    this.emit({ type: 'message.created', payload: { id: messageId, text, targets: [agent], runIds: [runId], createdAt: new Date().toISOString(),author:fakeAuthor,addressedToAll:false } }); this.status(runId, 'streaming');
    if (kind === 'failure') { this.emit({ type: 'run.delta', payload: { runId, text: 'Проверяю окружение…' } }); this.later(350, () => this.status(runId, 'failed', 'Tool process exited with code 1')); }
    if (kind === 'approval') { this.emit({ type: 'tool.updated', payload: { runId, tool: { id: 'tool-write', name: 'write_file', detail: 'src/ws-manager.ts', status: 'progress' } } }); this.later(250, () => this.emit({ type: 'request.created', payload: { runId, kind: 'approval', prompt: 'Разрешить запись src/ws-manager.ts в изолированный workspace?' } })); }
    if (kind === 'clarification') this.later(250, () => this.emit({ type: 'request.created', payload: { runId, kind: 'clarification', prompt: 'Какой режим reconnect выбрать: fixed delay или exponential backoff?' } }));
    if (kind === 'reconnect') { this.emit({ type: 'run.delta', payload: { runId, text: 'Получен текст до разрыва. ' } }); this.emit({ type: 'connection.changed', payload: { status: 'reconnecting' } }); this.later(500, () => this.emit({ type: 'connection.changed', payload: { status: 'replaying' } })); this.later(900, () => { this.emit({ type: 'connection.changed', payload: { status: 'connected' } }); this.emit({ type: 'run.delta', payload: { runId, text: 'Replay продолжил поток без дублей.' } }); this.status(runId, 'completed'); }); }
  }
  resolve(runId: string, value: string) { this.emit({ type: 'request.resolved', payload: { runId, resolution: value } }); this.later(350, () => { this.emit({ type: 'run.delta', payload: { runId, text: ` Решение принято: ${value}.` } }); this.status(runId, 'completed'); }); }
  cancel(runId?: string) { (runId ? [runId] : [...this.active]).forEach((id) => this.status(id, 'cancelled')); }
  dispose() { this.timers.forEach(clearTimeout); this.timers.clear(); this.listeners.clear(); }
}
