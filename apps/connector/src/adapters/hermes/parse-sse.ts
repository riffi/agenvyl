export type SseEvent = { event?: string; data: string };

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
      buffer = parts.pop() ?? '';
      for (const block of parts) {
        const event = parseBlock(block);
        if (event) yield event;
      }
      if (done) break;
    }
    const event = parseBlock(buffer.replace(/\r\n/g, '\n'));
    if (event) yield event;
  } finally {
    try { await reader.cancel(); } catch { /* the upstream may already be closed */ }
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseEvent | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }
  return data.length ? { ...(event ? { event } : {}), data: data.join('\n') } : undefined;
}
