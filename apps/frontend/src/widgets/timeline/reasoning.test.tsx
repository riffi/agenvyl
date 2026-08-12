// @vitest-environment jsdom

import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import {afterEach, describe, expect, it } from 'vitest';
import { ReasoningBlock, UpstreamStatusNotice } from './Timeline';

afterEach(cleanup);

describe('ReasoningBlock', () => {
  it('renders reasoning in a collapsed disclosure by default', () => {
    const {container}=render(<ReasoningBlock text={'**Planning**\n\n- inspect data\n- render safely'} />);
    const details=container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.queryByText('Planning')).toBeNull();
    fireEvent.click(screen.getByText('Reasoning').closest('summary')!);
    expect(screen.getByText('Planning').tagName).toBe('STRONG');
    expect(screen.getByText('inspect data').tagName).toBe('LI');
  });

  it('does not load images embedded in reasoning markdown',()=>{
    const {container}=render(<ReasoningBlock text="![private diagram](https://example.com/diagram.png)"/>);
    fireEvent.click(screen.getByText('Reasoning').closest('summary')!);
    expect(screen.getByText('[Image omitted: private diagram]')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('https://example.com/diagram.png');
  });

  it('restores paragraph boundaries in reasoning persisted by the legacy Codex adapter',()=>{
    const {container}=render(<ReasoningBlock harnessType="codex" text="**Inspecting data****Summarizing results**"/>);
    fireEvent.click(screen.getByText('Reasoning').closest('summary')!);
    expect(container.innerHTML).toContain('<p><strong>Inspecting data</strong></p>');
    expect(container.innerHTML).toContain('<p><strong>Summarizing results</strong></p>');
  });
});

describe('UpstreamStatusNotice',()=>{
  it('presents provider retry as a run-local transient state',()=>{
    const html=renderToStaticMarkup(<UpstreamStatusNotice status={{state:'retrying',reason:'provider_unavailable',retryable:true,attempt:3}}/>);
    expect(html).toContain('The provider is temporarily unavailable. Retrying…');
    expect(html).toContain('Attempt 3');
    expect(html).toContain('role="status"');
  });
});
