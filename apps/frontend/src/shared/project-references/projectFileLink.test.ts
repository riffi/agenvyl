import {describe, expect, it} from 'vitest';
import {isProjectFileLink, resolveProjectFileLink} from './projectFileLink';

const project = {id: 'p', name: 'Project', path: 'C:\\work\\game', availability: 'available' as const};
describe('project file links', () => {
  it.each(['project:src/my%20file.ts#L42', 'C:/work/game/src/my%20file.ts:42', 'c:\\WORK\\GAME\\src\\my file.ts:42:3', 'file:///C:/work/game/src/my%20file.ts#L42'])('resolves %s', url => {
    expect(resolveProjectFileLink(url, project)).toMatchObject({projectId: 'p', root: project.path, path: 'src/my file.ts', line: 42});
  });
  it.each(['C:/work/game-other/file.ts', 'project:../secret', 'project:%2e%2e/secret', 'project:/secret', 'project:.git/config', 'project:src/%00', 'project:src/file.ts#L0', 'project:src/%zz', 'https://example.com', 'javascript:alert(1)', '//example.com/file'])('rejects %s', url => {
    expect(resolveProjectFileLink(url, project)).toBeUndefined();
  });
  it('handles POSIX paths without ignoring case and requires project context', () => {
    const unix = {...project, path: '/srv/game'};
    expect(resolveProjectFileLink('/srv/game/main.ts', unix)?.path).toBe('main.ts');
    expect(resolveProjectFileLink('/srv/GAME/main.ts', unix)).toBeUndefined();
    expect(resolveProjectFileLink('project:main.ts')).toBeUndefined();
    expect(isProjectFileLink('https://example.com')).toBe(false);
  });
  it('keeps encoded filename fragments separate from the line suffix', () => {
    expect(resolveProjectFileLink('project:src/name%23L42.ts#L3', project)).toMatchObject({path: 'src/name#L42.ts', line: 3});
  });
});
