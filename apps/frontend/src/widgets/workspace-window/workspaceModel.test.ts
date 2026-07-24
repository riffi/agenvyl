import { describe, expect, it } from 'vitest';
import { decodeWorkspaceBytes, detectWorkspaceEncoding } from './workspaceText';
import { workspaceModesFor, workspaceRequestForTarget, workspaceRequestFromSearch, workspaceSearchWithRequest } from './workspaceModel';

describe('workspace viewer model', () => {
  it('assigns rendered and source modes without trusting MIME alone', () => {
    expect(workspaceModesFor({ path: 'page.html', mime_type: 'application/octet-stream' })).toEqual(['rendered', 'source']);
    expect(workspaceModesFor({ path: 'src/main.ts', mime_type: 'video/mp2t' })).toEqual(['source']);
    expect(workspaceModesFor({ path: 'photo.png', mime_type: 'image/png' })).toEqual(['rendered']);
  });

  it('round-trips the primary pane through workspace URL parameters', () => {
    const search = workspaceSearchWithRequest(new URLSearchParams('gateway=fake'), {
      origin: 'artifact',
      target: { entryId: 'entry-1', versionId: 'version-2' },
      mode: 'source',
      treeVisible: false,
    });
    expect(search.get('gateway')).toBe('fake');
    expect(workspaceRequestFromSearch(search)).toMatchObject({
      origin: 'artifact',
      target: { entryId: 'entry-1', versionId: 'version-2' },
      mode: 'source',
      treeVisible: false,
    });
  });

  it('opens a targeted file directly on compact screens', () => {
    const target = { entryId: 'entry-1', versionId: 'version-2' };
    expect(workspaceRequestForTarget(target, true)).toEqual({
      origin: 'workspace',
      target,
      treeVisible: false,
      followCurrent: false,
    });
    expect(workspaceRequestForTarget(target, false).treeVisible).toBe(true);
    expect(workspaceRequestForTarget(undefined, true).treeVisible).toBe(true);
  });

  it('detects BOM, strict UTF-8 and supports manual Cyrillic decoding', () => {
    expect(detectWorkspaceEncoding(new Uint8Array([0xef,0xbb,0xbf,0x61]))).toBe('utf-8');
    expect(detectWorkspaceEncoding(new TextEncoder().encode('Привет'))).toBe('utf-8');
    expect(decodeWorkspaceBytes(new Uint8Array([0xcf,0xf0,0xe8,0xe2,0xe5,0xf2]), 'windows-1251').text).toBe('Привет');
  });
});
