import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {afterEach,describe,expect,it} from 'vitest';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {scanWorkspaceTree} from './workspaceCapture.js';
import {directCaptureIgnoredDirectories} from './RunArtifactPolicy.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});

describe('workspace capture helpers',()=>{
  it('skips nested dependency and cache directories while retaining preview outputs',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'direct-capture-policy-'));roots.push(root);
    await Promise.all([
      mkdir(path.join(root,'packages','app','node_modules','dependency'),{recursive:true}),
      mkdir(path.join(root,'dist','assets'),{recursive:true}),
      mkdir(path.join(root,'.cache'),{recursive:true}),
    ]);
    await Promise.all([
      writeFile(path.join(root,'packages','app','node_modules','dependency','index.js'),'ignored'),
      writeFile(path.join(root,'dist','index.html'),'<main>preview</main>'),
      writeFile(path.join(root,'dist','assets','app.js'),'ready'),
      writeFile(path.join(root,'.cache','state'),'ignored'),
    ]);
    const scanned=await scanWorkspaceTree(root,1024*1024,'',directCaptureIgnoredDirectories),paths=scanned.entries.map(entry=>entry.path);
    expect(paths).toEqual(expect.arrayContaining(['dist','dist/index.html','dist/assets','dist/assets/app.js','packages','packages/app']));
    expect(paths.some(item=>item.includes('node_modules')||item.startsWith('.cache'))).toBe(false);
  });
});
