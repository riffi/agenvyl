import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReasoningBlock, UpstreamStatusNotice } from './Timeline';

describe('ReasoningBlock', () => {
  it('renders reasoning in a collapsed disclosure by default', () => {
    const html = renderToStaticMarkup(<ReasoningBlock text="private analysis" />);
    expect(html).toContain('Reasoning');
    expect(html).toContain('private analysis');
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
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
