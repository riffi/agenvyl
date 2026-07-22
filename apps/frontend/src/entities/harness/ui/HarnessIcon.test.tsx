import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {HarnessIcon} from './HarnessIcon';

describe('HarnessIcon',()=>{
  it('maps supported harness types to their accessible product names',()=>{
    const html=renderToStaticMarkup(<>{['hermes','opencode','antigravity'].map(type=><HarnessIcon key={type} type={type}/>)}</>);
    expect(html).toContain('aria-label="Hermes"');
    expect(html).toContain('aria-label="OpenCode"');
    expect(html).toContain('aria-label="Antigravity"');
    expect(html.match(/data-harness-size="sm"/g)).toHaveLength(3);
  });

  it('uses a generic local icon and the raw name for an unknown harness',()=>{
    const html=renderToStaticMarkup(<HarnessIcon type="future-runner" size="md"/>);
    expect(html).toContain('aria-label="future-runner"');
    expect(html).toContain('data-harness-type="future-runner"');
    expect(html).toContain('data-harness-size="md"');
    expect(html).toContain('lucide-cable');
  });
});
