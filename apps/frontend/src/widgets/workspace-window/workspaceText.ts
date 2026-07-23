import chardet from 'chardet';
import type { WorkspaceEncoding } from './workspaceModel';

export const SOURCE_HIGHLIGHT_LIMIT = 1024 * 1024;
export const SOURCE_PREVIEW_LIMIT = 5 * 1024 * 1024;

export const WORKSPACE_ENCODINGS: Array<{ value: WorkspaceEncoding; label: string }> = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'windows-1251', label: 'Windows-1251' },
  { value: 'windows-1252', label: 'Windows-1252' },
  { value: 'koi8-r', label: 'KOI8-R' },
];

const supported = new Set<WorkspaceEncoding>(WORKSPACE_ENCODINGS.map(item => item.value));

const normalizeEncoding = (value?: string | null): WorkspaceEncoding | undefined => {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replaceAll('_', '-').replace('utf8', 'utf-8');
  if (normalized === 'utf-16' || normalized === 'utf-16le') return 'utf-16le';
  if (normalized === 'utf-16be') return 'utf-16be';
  if (normalized === 'iso-8859-1') return 'windows-1252';
  return supported.has(normalized as WorkspaceEncoding) ? normalized as WorkspaceEncoding : undefined;
};

const bomEncoding = (bytes: Uint8Array): WorkspaceEncoding | undefined => {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return undefined;
};

const isStrictUtf8 = (bytes: Uint8Array) => {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

export const detectWorkspaceEncoding = (bytes: Uint8Array): WorkspaceEncoding => {
  const bom = bomEncoding(bytes);
  if (bom) return bom;
  if (isStrictUtf8(bytes)) return 'utf-8';
  return normalizeEncoding(chardet.detect(bytes)) ?? 'windows-1252';
};

export const decodeWorkspaceBytes = (bytes: Uint8Array, override?: WorkspaceEncoding) => {
  const encoding = override ?? detectWorkspaceEncoding(bytes);
  return {
    encoding,
    text: new TextDecoder(encoding, { fatal: false }).decode(bytes),
  };
};
