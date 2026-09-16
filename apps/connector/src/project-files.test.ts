import {mkdtemp,mkdir,writeFile,rm,symlink,realpath,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {inspectProject,listProject,projectTarget,readProject} from './project-files.js';
import {ProjectBuilds} from './project-builds.js';
import {buildConnectorApp} from './app.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){const root=await realpath(await mkdtemp(join(tmpdir(),'agenvyl project files ')));roots.push(root);return root;}
describe('project files',()=>{
  it('discovers current output and package manager, leaving equal candidates for selection',async()=>{
    const root=await fixture();
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'vite build'}}));
    await writeFile(join(root,'pnpm-lock.yaml'),'');
    await writeFile(join(root,'index.html'),'source');
    expect(await inspectProject(root)).toMatchObject({candidates:[],detected_command:'pnpm run build'});
    for(const directory of ['apps/a/dist','apps/b/dist','build','node_modules/ignored/dist']){await mkdir(join(root,directory),{recursive:true});await writeFile(join(root,directory,'index.html'),'built');}
    expect((await inspectProject(root)).candidates).toEqual(['apps/a/dist/index.html','apps/b/dist/index.html']);
    await mkdir(join(root,'dist'));await writeFile(join(root,'dist/index.html'),'current');
    expect((await inspectProject(root)).candidates).toEqual(['dist/index.html']);
  });
  it('reads current bytes, lists real files, blocks traversal, links, Git internals and oversized reads',async()=>{
    const root=await fixture(),outside=await fixture();
    await writeFile(join(root,'hello.txt'),'one');await mkdir(join(root,'.git'));await writeFile(join(outside,'secret.txt'),'secret');
    await symlink(outside,join(root,'linked'),'junction');
    expect((await listProject(root)).entries.map(file=>file.name)).toEqual(['hello.txt']);
    expect((await readProject(root,'hello.txt')).data.toString()).toBe('one');
    await writeFile(join(root,'hello.txt'),'two');expect((await readProject(root,'hello.txt')).data.toString()).toBe('two');
    for(const relative of ['../secret.txt','C:/secret','/secret','.git/config','.GIT./config','hello.txt:stream','linked/secret.txt'])await expect(projectTarget(root,relative)).rejects.toBeDefined();
    await expect(readProject(root,'hello.txt',2)).rejects.toMatchObject({code:'project_file_large'});
  });
  it('authenticates project endpoints and confines preview assets to the selected HTML directory',async()=>{
    const root=await fixture();await mkdir(join(root,'dist'));await writeFile(join(root,'dist/index.html'),'<h1>built</h1>');await writeFile(join(root,'secret.txt'),'secret');
    const token='x'.repeat(32),app=buildConnectorApp({version:1,token,listen:{host:'127.0.0.1',port:4310},workspaces:{roots:[]},instances:[]});
    try{
      const request={method:'POST' as const,url:'/v2/project-files/preview',payload:{root,entrypoint:'dist/index.html',path:''}};
      expect((await app.inject(request)).statusCode).toBe(401);
      const ok=await app.inject({...request,headers:{authorization:`Bearer ${token}`}});expect(ok.statusCode).toBe(200);expect(Buffer.from(ok.json().data,'base64').toString()).toContain('built');
      expect((await app.inject({...request,headers:{authorization:`Bearer ${token}`},payload:{...request.payload,path:'../secret.txt'}})).statusCode).toBe(400);
    }finally{await app.close();}
  });
  it('builds directly in the project, captures logs and exit status, rejects concurrent builds',async()=>{
    const root=await fixture(),builds=new ProjectBuilds();
    await writeFile(join(root,'build.cjs'),"require('fs').writeFileSync('built.txt','done'); console.log('built in project'); setTimeout(()=>{},200);");
    try{
      const state=builds.start(root,`"${process.execPath}" build.cjs`);
      expect(()=>builds.start(root,'anything')).toThrow('already running');
      await expect.poll(()=>state.status,{timeout:15000}).toBe('completed');
      expect(state.log).toContain('built in project');expect(state.exit_code).toBe(0);
      expect(await readFile(join(root,'built.txt'),'utf8')).toBe('done');
      const failure=builds.start(root,`"${process.execPath}" -e "process.exit(3)"`);
      await expect.poll(()=>failure.status,{timeout:15000}).toBe('failed');expect(failure.exit_code).toBe(3);
    }finally{await builds.close();}
  },35000);
  it('cancels a build and releases its directory lock after process exit',async()=>{
    const root=await fixture(),builds=new ProjectBuilds();
    await writeFile(join(root,'wait.cjs'),"console.log('ready');setInterval(()=>{},1000)");
    try{
      const state=builds.start(root,`"${process.execPath}" wait.cjs`);
      await expect.poll(()=>state.log,{timeout:15000}).toContain('ready');
      expect(builds.cancel(root)?.status).toBe('cancelled');
      await builds.close();
      const next=builds.start(root,`"${process.execPath}" -e "console.log('next')"`);
      await expect.poll(()=>next.status,{timeout:15000}).toBe('completed');
    }finally{await builds.close();}
  },35000);
});
