export function parseMentions(text: string, handles: string[]): string[] {
  const known = new Set(handles.map(handle => handle.toLowerCase()));
  const result: string[] = [];
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/giu)) {
    const handle = match[2].toLowerCase();
    const targets = handle === 'all' ? handles : known.has(handle) ? [handle] : [];
    for (const target of targets) if (!result.includes(target)) result.push(target);
  }
  return result;
}
