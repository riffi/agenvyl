export interface RoomEventStream<Event> {
  subscribe(listener: (event: Event) => void): () => void;
  dispose(): void;
}
