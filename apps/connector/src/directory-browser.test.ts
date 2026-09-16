import {mkdtemp,mkdir,writeFile,rm,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {browseDirectories,directoryParent,directoryRootCandidates,directoryBrowseError} from './directory-browser.js';
import {buildConnectorApp} from './app.js';

const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function fixture(){const root=await realpath(await mkdtemp(join(tmpdir(),'agenvyl-browser-')));temporary.push(root);return root;}
describe('directory browser',()=>{
  it('lists folders and linked folders lazily, without a workspace boundary',async()=>{
    const root=await fixture(),outside=await fixture();
    await mkdir(join(root,'folder'));await writeFile(join(root,'file.txt'),'not a folder');
    await symlink(outside,join(root,'linked'),'junction');
    const listing=await browseDirectories(root);
    expect(listing.entries.map(entry=>entry.name)).toEqual(['folder','linked']);
    expect(listing.parent).toBe(directoryParent(root,process.platform));
    expect((await browseDirectories(join(root,'linked'))).path).toBe(outside);
    await expect(browseDirectories('relative')).rejects.toThrow('absolute');
    await expect(browseDirectories(join(root,'missing'))).rejects.toMatchObject({code:'ENOENT'});
    await expect(browseDirectories(join(root,'file.txt'))).rejects.toMatchObject({code:'ENOTDIR'});
  });
  it('offers native roots and stops parent navigation only at filesystem roots',()=>{
    expect(directoryRootCandidates('win32','C:\\Users\\me')).toContainEqual({name:'Z:',path:'Z:\\'});
    expect(directoryRootCandidates('linux','/home/me')).toEqual([{name:'Home',path:'/home/me'},{name:'File system',path:'/'}]);
    expect(directoryRootCandidates('darwin','/Users/me')).toContainEqual({name:'Volumes',path:'/Volumes'});
    expect(directoryParent('C:\\','win32')).toBeNull();
    expect(directoryParent('C:\\work\\project','win32')).toBe('C:\\work');
    expect(directoryParent('\\\\server\\share\\folder','win32')).toBe('\\\\server\\share\\');
    expect(directoryParent('\\\\server\\share\\','win32')).toBeNull();
    expect(directoryParent('/','linux')).toBeNull();
    expect(directoryParent('/Volumes/Disk','darwin')).toBe('/Volumes');
    expect(directoryBrowseError({code:'EACCES'})).toBe('Permission denied for this folder.');
  });
  it('requires Connector authentication and handles inaccessible paths',async()=>{
    const root=await fixture(),token='x'.repeat(32);
    const app=buildConnectorApp({version:1,token,listen:{host:'127.0.0.1',port:4310},workspaces:{roots:[]},instances:[]});
    try{
      const request={method:'POST' as const,url:'/v2/directories/browse',payload:{path:root}};
      expect((await app.inject(request)).statusCode).toBe(401);
      const headers={authorization:`Bearer ${token}`};
      expect((await app.inject({...request,headers})).json()).toMatchObject({path:root,entries:[]});
      const missing=await app.inject({...request,headers,payload:{path:join(root,'missing')}});
      expect(missing.statusCode).toBe(400);expect(missing.json().message).toBe('Folder no longer exists.');
      expect((await app.inject({...request,headers,payload:{}})).json()).toMatchObject({path:null,parent:null,entries:expect.any(Array)});
    }finally{await app.close();}
  });
});
