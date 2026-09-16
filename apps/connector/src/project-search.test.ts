import {mkdtemp,mkdir,writeFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {searchProject} from './project-search.js';
const roots:string[]=[];
async function fixture(){const root=await realpath(await mkdtemp(join(tmpdir(),'agenvyl-search-')));roots.push(root);return root;}
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
describe('project path search',()=>{
  it('searches nested paths case-insensitively, including spaces, without following links or dependencies',async()=>{
    const root=await fixture(),outside=await fixture();
    for(const directory of ['src/ui','.git','node_modules'])await mkdir(join(root,directory),{recursive:true});
    await writeFile(join(root,'src/ui/My Button.tsx'),'source');
    await writeFile(join(root,'node_modules/secret.tsx'),'dependency');
    await writeFile(join(root,'.git/secret.tsx'),'git');
    await writeFile(join(outside,'secret.tsx'),'outside');
    await symlink(outside,join(root,'linked'),'junction');
    expect((await searchProject(root,'BUTTON')).entries.map(file=>file.path)).toEqual(['src/ui/My Button.tsx']);
    expect((await searchProject(root,'src\\ui')).entries.map(file=>file.path)).toEqual(['src/ui','src/ui/My Button.tsx']);
    expect((await searchProject(root,'secret')).entries).toEqual([]);
    expect((await searchProject(root,'')).entries.map(file=>file.path)).toEqual(['src']);
  });
  it('bounds result count and reports missing roots instead of empty results',async()=>{
    const root=await fixture();
    for(let i=0;i<40;i++)await writeFile(join(root,`file${i}.txt`),'');
    expect(await searchProject(root,'file')).toMatchObject({truncated:true});
    expect((await searchProject(root,'file')).entries).toHaveLength(30);
    await expect(searchProject(join(root,'missing'),'file')).rejects.toBeDefined();
  });
});
