export type TimelineLayoutMode = 'adaptive' | 'list' | 'grid';

export const TIMELINE_LAYOUT_STORAGE_KEY = 'hermes.timeline-layout';

export const parseTimelineLayoutMode = (value: string | null): TimelineLayoutMode =>
  value === 'list' || value === 'grid' || value === 'adaptive' ? value : 'adaptive';

export const readTimelineLayoutMode = (storage?: Pick<Storage, 'getItem'>): TimelineLayoutMode => {
  try {
    return parseTimelineLayoutMode(storage?.getItem(TIMELINE_LAYOUT_STORAGE_KEY) ?? null);
  } catch {
    return 'adaptive';
  }
};

export const saveTimelineLayoutMode = (mode: TimelineLayoutMode, storage?: Pick<Storage, 'setItem'>) => {
  try {
    storage?.setItem(TIMELINE_LAYOUT_STORAGE_KEY, mode);
  } catch {
    // The preference remains active for this session when storage is unavailable.
  }
};

const hasFencedCode = (text: string) => /(^|\n)\s*(```|~~~)/.test(text);
const hasMarkdownTable = (text: string) => {
  const lines = text.split(/\r?\n/);
  return lines.some((line, index) => index > 0
    && line.includes('|')
    && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
    && lines[index - 1].includes('|'));
};

export const isLongAnswer = (text: string) => text.length >= 900;

export const shouldUseSingleColumn = (answers: string[]) => answers.length <= 1
  || answers.some(text => isLongAnswer(text) || hasFencedCode(text) || hasMarkdownTable(text));
