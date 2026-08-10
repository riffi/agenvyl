import { describe, expect, it } from 'vitest';
import { deriveRoomTitle } from '../src/roomTitle.js';

describe('deriveRoomTitle', () => {
  it('uses the first substantive English or Russian sentence', () => {
    expect(deriveRoomTitle({ text: 'Hello. Fix the OAuth redirect. Then add tests.' })).toBe('Fix the OAuth redirect.');
    expect(deriveRoomTitle({ text: 'Привет! Исправь создание комнаты. Потом добавь тесты.' })).toBe('Исправь создание комнаты.');
  });

  it('removes agent mentions and Markdown decoration while keeping content', () => {
    expect(deriveRoomTitle({ text: '@architect **Review** [the release plan](https://example.com).' })).toBe('Review the release plan.');
    expect(deriveRoomTitle({ text: '```ts\nexport const room = true;\n```' })).toBe('export const room = true;');
  });

  it('keeps a pending title for mention-only messages', () => {
    expect(deriveRoomTitle({ text: '@all @architect' })).toBeUndefined();
  });

  it('falls back to attachment names with correct pluralization', () => {
    expect(deriveRoomTitle({ attachmentNames: ['brief.pdf'] })).toBe('brief.pdf');
    expect(deriveRoomTitle({ attachmentNames: ['brief.pdf', 'mock.png'] })).toBe('brief.pdf + 1 file');
    expect(deriveRoomTitle({ attachmentNames: ['brief.pdf', 'mock.png', 'data.csv'] })).toBe('brief.pdf + 2 files');
  });

  it('supports CJK and truncates at Unicode grapheme boundaries', () => {
    expect(deriveRoomTitle({ text: '認証フローを修正してください。次にテストを追加してください。' })).toBe('認証フローを修正してください。');
    const title = deriveRoomTitle({ text: `${'👩🏽‍💻'.repeat(30)}${'a'.repeat(80)}` });
    expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(title ?? '')]).toHaveLength(64);
    expect(title?.endsWith('…')).toBe(true);
  });
});
