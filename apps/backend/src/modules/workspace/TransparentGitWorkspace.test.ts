import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {TransparentGitWorkspace} from './TransparentGitWorkspace.js';

describe('TransparentGitWorkspace',()=>{
  const roots:string[]=[];
  afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});

  it('creates a visible repository and checkpoints the actual room folder',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'agenvyl-git-'));roots.push(root);
    const workspace=new TransparentGitWorkspace(),prepared=await workspace.prepare(root,'run-1');
    expect(await readFile(path.join(root,'.gitignore'),'utf8')).toContain('node_modules/');
    await writeFile(path.join(root,'index.html'),'<h1>hello</h1>');
    await mkdir(path.join(root,'.edge-render-profile'),{recursive:true});
    await writeFile(path.join(root,'.edge-render-profile','Cache'),'temporary browser state');
    const finalized=await workspace.finalize(root,'run-1','completed');
    expect(finalized.head).not.toBe(prepared.head);
    expect(finalized.checkpointSha).toBe(finalized.head);
    await writeFile(path.join(root,'.edge-render-profile','Cache'),'changed temporary browser state');
    const ignored=await workspace.finalize(root,'run-2','completed');
    expect(ignored.head).toBe(finalized.head);
    expect(ignored.checkpointSha).toBeUndefined();
  });

  it('does not add a checkpoint when the agent committed its clean tree',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'agenvyl-git-'));roots.push(root);
    const workspace=new TransparentGitWorkspace();await workspace.prepare(root,'run-1');
    const finalized=await workspace.finalize(root,'run-1','completed');
    expect(finalized.checkpointSha).toBeUndefined();
  });
});
