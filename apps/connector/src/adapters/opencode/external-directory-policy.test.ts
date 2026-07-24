import {describe,expect,it} from 'vitest';
import {assessExternalDirectoryRequest,isAllowlistedExternalDirectoryRequest,parseOpenCodePermissionProfile} from './external-directory-policy.js';

describe('OpenCode external-directory policy',()=>{
  it.each([
    ['/srv/shared/file.txt','/srv/shared',['/srv/shared/file.txt/**'],['/srv/shared']],
    ['C:\\Shared\\file.txt','C:\\Shared',['C:\\Shared\\file.txt\\**'],['c:\\shared']],
    ['\\\\server\\share\\folder\\file.txt','\\\\server\\share\\folder',['\\\\server\\share\\folder\\file.txt\\*'],['\\\\server\\share']],
  ])('allows a concrete request contained by an absolute root', (filepath,parentDir,resources,roots)=>{
    expect(isAllowlistedExternalDirectoryRequest({metadata:{filepath,parentDir},resources},roots)).toBe(true);
  });

  it('returns a normalized candidate root for a valid request outside the allowlist',()=>{
    expect(assessExternalDirectoryRequest({
      metadata:{filepath:'C:\\work\\joke.txt',parentDir:'C:\\work'},
      resources:['C:\\work\\joke.txt\\**'],
    },[])).toEqual({status:'outside_allowlist',requestedRoot:'C:\\work'});
  });

  it.each([
    ['empty allowlist',{metadata:{filepath:'/srv/shared/file.txt',parentDir:'/srv/shared'},resources:['/srv/shared/file.txt/**']},[]],
    ['prefix collision',{metadata:{filepath:'/srv/shared-secret/file.txt',parentDir:'/srv/shared-secret'},resources:['/srv/shared-secret/file.txt/**']},['/srv/shared']],
    ['filepath traversal',{metadata:{filepath:'/srv/shared/../secret.txt',parentDir:'/srv/shared'},resources:['/srv/shared/../secret.txt/**']},['/srv/shared']],
    ['parent traversal',{metadata:{filepath:'/srv/shared/file.txt',parentDir:'/srv/shared/../shared'},resources:['/srv/shared/file.txt/**']},['/srv/shared']],
    ['resource traversal',{metadata:{filepath:'/srv/shared/file.txt',parentDir:'/srv/shared'},resources:['/srv/shared/../secret.txt/**']},['/srv/shared']],
    ['mixed separators',{metadata:{filepath:'C:\\Shared/file.txt',parentDir:'C:\\Shared'},resources:['C:\\Shared\\file.txt\\**']},['C:\\Shared']],
    ['relative filepath',{metadata:{filepath:'shared/file.txt',parentDir:'/srv/shared'},resources:['/srv/shared/file.txt/**']},['/srv/shared']],
    ['missing metadata',{resources:['/srv/shared/file.txt/**']},['/srv/shared']],
    ['wildcard metadata',{metadata:{filepath:'/srv/shared/*.txt',parentDir:'/srv/shared'},resources:['/srv/shared/*.txt']},['/srv/shared']],
    ['wildcard root',{metadata:{filepath:'/srv/shared/file.txt',parentDir:'/srv/shared'},resources:['/srv/shared/file.txt/**']},['/srv/*']],
    ['cross-platform root',{metadata:{filepath:'/srv/shared/file.txt',parentDir:'/srv/shared'},resources:['/srv/shared/file.txt/**']},['C:\\srv\\shared']],
  ])('rejects %s',(_label,properties,roots)=>{
    expect(isAllowlistedExternalDirectoryRequest(properties,roots)).toBe(false);
  });

  it('does not offer a root when a resource escapes the proposed parent directory',()=>{
    expect(assessExternalDirectoryRequest({
      metadata:{filepath:'/srv/shared/file.txt',parentDir:'/srv/shared'},
      resources:['/srv/secrets/file.txt/**'],
    },[])).toEqual({status:'malformed'});
  });

  it('defaults legacy null profiles to Standard and rejects unknown profile ids',()=>{
    expect(parseOpenCodePermissionProfile(null)).toBe('standard');
    expect(parseOpenCodePermissionProfile('standard')).toBe('standard');
    expect(parseOpenCodePermissionProfile('auto-approve')).toBe('auto-approve');
    expect(()=>parseOpenCodePermissionProfile('full-access')).toThrow('invalid');
  });
});
