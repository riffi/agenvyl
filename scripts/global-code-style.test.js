import {readFile} from 'node:fs/promises';
import {describe,expect,it} from 'vitest';

describe('global code styles',()=>{
  it('decorates inline code without leaking into fenced code blocks',async()=>{
    const stylesheet=await readFile(new URL('../apps/frontend/src/app/styles/globals.css',import.meta.url),'utf8');
    expect(stylesheet).toMatch(/:not\(pre\) > code\s*\{/);
    expect(stylesheet).not.toMatch(/(^|})\s*code\s*\{/m);
  });
});
