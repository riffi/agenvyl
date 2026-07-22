import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReasoningBlock, UpstreamStatusNotice } from './Timeline';

describe('ReasoningBlock', () => {
  it('renders reasoning in a collapsed disclosure by default', () => {
    const html = renderToStaticMarkup(<ReasoningBlock text={'**Planning**\n\n- inspect data\n- render safely'} />);
    expect(html).toContain('Reasoning');
    expect(html).toContain('<strong>Planning</strong>');
    expect(html).toContain('<li>inspect data</li>');
    expect(html).not.toContain('**Planning**');
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
  });

  it('does not load images embedded in reasoning markdown',()=>{
    const html=renderToStaticMarkup(<ReasoningBlock text="![private diagram](https://example.com/diagram.png)"/>);
    expect(html).toContain('[Image omitted: private diagram]');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('https://example.com/diagram.png');
  });

  it('restores paragraph boundaries in reasoning persisted by the legacy Codex adapter',()=>{
    const html=renderToStaticMarkup(<ReasoningBlock harnessType="codex" text="**Inspecting data****Summarizing results**"/>);
    expect(html).toContain('<p><strong>Inspecting data</strong></p>');
    expect(html).toContain('<p><strong>Summarizing results</strong></p>');
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
