export const DEFAULT_ROOM_TITLE = 'New room';

export type DeriveRoomTitleInput = {
  text?: string;
  attachmentNames?: readonly string[];
};

const MAX_TITLE_GRAPHEMES = 64;
const greetings = new Set([
  'hi',
  'hello',
  'hey',
  'привет',
  'здравствуйте',
  'добрый день',
  'доброе утро',
  'добрый вечер',
]);
const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export const deriveRoomTitle = ({ text = '', attachmentNames = [] }: DeriveRoomTitleInput) => {
  const candidates = sentenceCandidates(cleanMessage(text));
  const preferred = candidates.find(candidate => wordCount(candidate) >= 2) ?? candidates[0];
  if (preferred) return truncateTitle(preferred);

  const names = attachmentNames.map(normalizeWhitespace).filter(Boolean);
  if (!names.length) return undefined;
  const extraCount = names.length - 1;
  const suffix = extraCount ? ` + ${extraCount} ${extraCount === 1 ? 'file' : 'files'}` : '';
  return truncateTitle(`${names[0]}${suffix}`);
};

const cleanMessage = (value: string) => value
  .normalize('NFC')
  .replace(/\r\n?/g, '\n')
  .replace(/^\s{0,3}```[^\n]*$/gmu, '')
  .replace(/^\s{0,3}~~~[^\n]*$/gmu, '')
  .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
  .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/giu, '$1')
  .replace(/<[^>]+>/gu, ' ')
  .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gmu, '')
  .replace(/^\s*\[[ xX]\]\s*/gmu, '')
  .replace(/(^|[\s,;:()[\]{}])@(?:all|[a-z0-9][a-z0-9_-]*)(?=$|[^\p{L}\p{N}_-])/giu, '$1')
  .replace(/[`*~]/gu, '')
  .replace(/[ \t]+/gu, ' ')
  .replace(/\s*\n+\s*/gu, '\n')
  .trim();

const sentenceCandidates = (value: string) => {
  if (!value) return [];
  return [...sentenceSegmenter.segment(value)]
    .map(item => normalizeWhitespace(item.segment))
    .filter(candidate => /[\p{L}\p{N}]/u.test(candidate))
    .filter(candidate => !isGreeting(candidate));
};

const isGreeting = (value: string) => greetings.has(
  value.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim(),
);

const wordCount = (value: string) => [...wordSegmenter.segment(value)]
  .filter(item => item.isWordLike)
  .length;

const normalizeWhitespace = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim();

const truncateTitle = (value: string) => {
  const normalized = normalizeWhitespace(value);
  const graphemes = [...graphemeSegmenter.segment(normalized)].map(item => item.segment);
  if (graphemes.length <= MAX_TITLE_GRAPHEMES) return normalized;

  const prefix = graphemes.slice(0, MAX_TITLE_GRAPHEMES - 1).join('');
  const boundary = Math.max(prefix.lastIndexOf(' '), prefix.lastIndexOf('\n'));
  const shortened = boundary >= Math.floor(MAX_TITLE_GRAPHEMES / 2)
    ? prefix.slice(0, boundary)
    : prefix;
  return `${shortened.trimEnd()}…`;
};
