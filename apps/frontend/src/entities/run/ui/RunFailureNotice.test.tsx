import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {RunFailureNotice} from './RunFailureNotice';

describe('RunFailureNotice',()=>{
  it('explains a provider region opt-in without exposing raw provider data',()=>{
    const html=renderToStaticMarkup(<RunFailureNotice errorCode="provider_region_opt_in_required" error="raw provider response"/>);
    expect(html).toContain('Model requires additional setup');
    expect(html).toContain('Enable it in the OpenCode Go workspace settings');
    expect(html).toContain('href="https://opencode.ai/workspace"');
    expect(html).not.toContain('raw provider response');
  });

  it('retains a normalized fallback error',()=>{
    const html=renderToStaticMarkup(<RunFailureNotice errorCode="unknown_failure" error="Safe fallback message"/>);
    expect(html).toContain('Could not complete');
    expect(html).toContain('Safe fallback message');
  });
});
