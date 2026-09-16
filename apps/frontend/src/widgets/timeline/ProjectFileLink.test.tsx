// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Run} from '../../entities/run';
import {ProjectReferenceContext} from '../../shared/project-references/ProjectReferenceContext';
import {MarkdownAnswer} from './MarkdownAnswer';

afterEach(cleanup);
const project = {id: 'p', name: 'Game', path: 'C:/work/game', availability: 'available' as const};
const run = {id: 'run', status: 'completed', recommendedProject: project} as Run;
describe('file links in answers', () => {
  it('opens historical absolute paths and new project links without browser navigation', () => {
    const open = vi.fn();
    render(<ProjectReferenceContext.Provider value={{open, insert: vi.fn(), project: {...project, id: 'another'}}}>
      <MarkdownAnswer text="[old](C:/work/game/src/boss.js:42) [new](project:src/boss.js#L42)" run={run}/>
    </ProjectReferenceContext.Provider>);
    fireEvent.click(screen.getByRole('button', {name: 'old'}));
    fireEvent.click(screen.getByRole('button', {name: 'new'}));
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith({projectId: 'p', projectName: 'Game', root: project.path, path: 'src/boss.js', kind: 'file', line: 42});
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('offers copying an unmapped path and handles clipboard failure', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}});
    render(<MarkdownAnswer text="[missing](C:/other/file.ts)" run={run}/>);
    fireEvent.click(screen.getByRole('button', {name: 'missing'}));
    fireEvent.click(screen.getByRole('button', {name: 'Copy path: C:/other/file.ts'}));
    await waitFor(() => expect(screen.getByText('Could not copy. Path: C:/other/file.ts')).toBeTruthy());
  });
  it('keeps web links and never renders empty or unsafe destinations as links', () => {
    render(<MarkdownAnswer text="[web](https://example.com) [bad](javascript:evil) [empty]()" run={run}/>);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.com');
  });
});
