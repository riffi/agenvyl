import {describe,expect,it} from 'vitest';
import {extractExternalImageReferences,extractWorkspaceImageReferences} from './workspaceEmbeds.js';

describe('workspace image syntax',()=>{
  it('extracts unique decoded paths and ignores code',()=>{
    const text='![График](workspace:reports/chart%20one.png)\n`![no](workspace:no.png)`\n```md\n![no](workspace:fenced.png)\n```\n![Снова](workspace:reports/chart%20one.png)';
    expect(extractWorkspaceImageReferences(text)).toEqual([{path:'reports/chart one.png'}]);
  });
  it('reports unsafe paths and references beyond the limit',()=>{
    const text=['![bad](workspace:../secret.png)',...Array.from({length:11},(_,index)=>`![${index}](workspace:images/${index}.png)`)].join('\n');
    const result=extractWorkspaceImageReferences(text,10);
    expect(result[0]).toEqual({path:'../secret.png',error:'invalid_path'});
    expect(result.at(-1)).toEqual({path:'images/10.png',error:'limit_exceeded'});
  });
  it('finds external image hotlinks but ignores ordinary links and code',()=>{
    const text='![NASA](https://example.com/space.jpg)\n[Источник](https://example.com/page)\n`![code](https://example.com/code.png)`\n![NASA again](https://example.com/space.jpg "title")';
    expect(extractExternalImageReferences(text)).toEqual(['https://example.com/space.jpg']);
  });
});
