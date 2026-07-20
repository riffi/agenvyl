import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomEvent } from '../../../entities/room';
import { WebSocketRoomEventStream } from './WebSocketRoomEventStream';

class Socket {
  static instances: Socket[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  readyState = 1;
  constructor(readonly url: string) { Socket.instances.push(this); }
  close() { this.onclose?.(); }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); Socket.instances = []; });

describe('WebSocketRoomEventStream', () => {
  it('reconnects with the last applied sequence and deduplicates replay', () => {
    vi.useFakeTimers();
    vi.stubGlobal('location', { protocol: 'https:', host: 'chat.test' });
    vi.stubGlobal('WebSocket', Socket);
    const stream = new WebSocketRoomEventStream<RoomEvent>('room / 1');
    const received: RoomEvent[] = [];
    stream.subscribe((event) => received.push(event));
    const event = { id: 'event-4', sequence: 4, type: 'message.created', payload: { id: 'message-1', text: 'hello', targets: [], runIds: [], createdAt: '2026-07-15',author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false } } as RoomEvent;
    Socket.instances[0].onmessage?.({ data: JSON.stringify(event) });
    Socket.instances[0].onmessage?.({ data: JSON.stringify(event) });
    Socket.instances[0].onclose?.();
    vi.advanceTimersByTime(1000);
    expect(Socket.instances.map((socket) => socket.url)).toEqual([
      'wss://chat.test/api/v1/rooms/room%20%2F%201/events?after=0',
      'wss://chat.test/api/v1/rooms/room%20%2F%201/events?after=4',
    ]);
    expect(received.filter((item) => item.type === 'message.created')).toEqual([event]);
    stream.dispose();
  });

  it('ignores malformed messages and does not reconnect after dispose', () => {
    vi.useFakeTimers();
    vi.stubGlobal('location', { protocol: 'http:', host: 'chat.test' });
    vi.stubGlobal('WebSocket', Socket);
    const stream = new WebSocketRoomEventStream<RoomEvent>('room-1');
    const listener = vi.fn();
    stream.subscribe(listener);
    Socket.instances[0].onmessage?.({ data: 'not-json' });
    Socket.instances[0].onmessage?.({ data: JSON.stringify({ id: 'bad', sequence: 1, type: 'unknown', payload: {} }) });
    expect(listener).not.toHaveBeenCalled();
    stream.dispose();
    vi.advanceTimersByTime(5000);
    expect(Socket.instances).toHaveLength(1);
  });
});
