import type { RoomEventStream } from './RoomEventStream';
import { isServerRoomEvent } from '@agenvyl/contracts';

type SequencedEvent = { id:string; sequence:number; type:string; payload:unknown };

export class WebSocketRoomEventStream<Event extends SequencedEvent> implements RoomEventStream<Event> {
  private listeners = new Set<(event: Event) => void>();
  private socket?: WebSocket;
  private stopped = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private lastSequence: number;
  private pending: Event[] = [];
  private connectedReported=false;

  constructor(private readonly roomId: string,initialSequence=0,connectImmediately=true) {
    this.lastSequence=initialSequence??0;
    if(connectImmediately)this.connect();
  }

  subscribe(listener: (event: Event) => void) {
    this.listeners.add(listener);
    if (this.stopped) { this.stopped = false; this.connect(); }
    if (this.pending.length) {
      const pending = this.pending;
      this.pending = [];
      pending.forEach((event) => listener(event));
    }
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: Event) {
    if (event.type !== 'connection.changed') {
      if (event.sequence <= this.lastSequence) return;
      this.lastSequence = event.sequence;
    }
    if (this.listeners.size === 0) { this.pending.push(event); return; }
    this.listeners.forEach((listener) => listener(event));
  }

  private connection(status: 'connected' | 'reconnecting' | 'replaying') {
    this.connectedReported=status==='connected';
    this.emit({ id: `local-${Date.now()}`, sequence: this.lastSequence, type: 'connection.changed', payload: { status } } as Event);
  }

  private connect() {
    if (this.stopped || !this.roomId) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(`${protocol}//${location.host}/api/v1/rooms/${encodeURIComponent(this.roomId)}/events?after=${this.lastSequence}`);
    this.socket.onopen = () => this.connection('connected');
    this.socket.onmessage = (message) => {
      try {
        const event: unknown = JSON.parse(String(message.data));
        if (!isServerRoomEvent(event)) return;
        this.emit(event as Event);
        if(!this.connectedReported)this.connection('connected');
      }
      catch { /* malformed upstream events are isolated from subscribers */ }
    };
    this.socket.onclose = () => {
      if (this.stopped) return;
      this.connectedReported=false;
      this.connection('reconnecting');
      this.reconnectTimer = setTimeout(() => this.connect(), 1000);
    };
  }

  dispose() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.pending = [];
    this.listeners.clear();
  }
}
