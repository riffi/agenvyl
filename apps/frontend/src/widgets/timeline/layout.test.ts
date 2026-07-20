import { describe, expect, it, vi } from 'vitest';
import {
  parseTimelineLayoutMode,
  readTimelineLayoutMode,
  saveTimelineLayoutMode,
  isLongAnswer,
  shouldUseSingleColumn,
  TIMELINE_LAYOUT_STORAGE_KEY,
} from './layout';

describe('timeline layout', () => {
  it('keeps short multi-agent rounds in a grid', () => {
    expect(shouldUseSingleColumn(['Коротко', 'Тоже коротко'])).toBe(false);
  });

  it('uses one column for one answer or an answer at the length threshold', () => {
    expect(shouldUseSingleColumn(['Один ответ'])).toBe(true);
    expect(shouldUseSingleColumn(['коротко', 'x'.repeat(900)])).toBe(true);
  });

  it('marks answers as long at the preview threshold', () => {
    expect(isLongAnswer('x'.repeat(899))).toBe(false);
    expect(isLongAnswer('x'.repeat(900))).toBe(true);
  });

  it('detects fenced code and Markdown tables', () => {
    expect(shouldUseSingleColumn(['коротко', '```ts\nconst x = 1;\n```'])).toBe(true);
    expect(shouldUseSingleColumn(['коротко', '| Имя | Роль |\n| --- | :---: |\n| Hermes | чат |'])).toBe(true);
  });

  it('parses known values and falls back to adaptive', () => {
    expect(parseTimelineLayoutMode('grid')).toBe('grid');
    expect(parseTimelineLayoutMode('list')).toBe('list');
    expect(parseTimelineLayoutMode('broken')).toBe('adaptive');
    expect(parseTimelineLayoutMode(null)).toBe('adaptive');
  });

  it('reads and saves the global preference safely', () => {
    const storage = { getItem: vi.fn(() => 'grid'), setItem: vi.fn() };
    expect(readTimelineLayoutMode(storage)).toBe('grid');
    saveTimelineLayoutMode('list', storage);
    expect(storage.setItem).toHaveBeenCalledWith(TIMELINE_LAYOUT_STORAGE_KEY, 'list');
    expect(readTimelineLayoutMode({ getItem: () => { throw new Error('blocked'); } })).toBe('adaptive');
  });
});
