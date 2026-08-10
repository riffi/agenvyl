import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {PreviewBundleStore} from './PreviewBundleStore.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});

describe('PreviewBundleStore',()=>{
  it('publishes one immutable ZIP and reads exact historical assets',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'preview-store-'));roots.push(root);
    const store=new PreviewBundleStore(root,1024*1024),files=[
      {path:'index.html',data:Buffer.from('<script src="assets/app.js"></script>'),mimeType:'text/html'},
      {path:'assets/app.js',data:Buffer.from('document.body.dataset.version="old"'),mimeType:'text/javascript'},
    ];
    const first=await store.write('preview_1','index.html',files),second=await store.write('preview_1','index.html',files);
    expect(second.bundleSha256).toBe(first.bundleSha256);
    expect((await store.read('preview_1','assets/app.js')).data.toString()).toContain('version="old"');
    expect(JSON.parse(await readFile(path.join(root,'preview_1','metadata.json'),'utf8'))).toMatchObject({entrypoint:'index.html',bundleSha256:first.bundleSha256,files:[{path:'assets/app.js'},{path:'index.html'}]});
    await expect(store.read('preview_1','../secret')).rejects.toThrow('Invalid preview bundle path');
  });

  it('rejects oversized and conflicting immutable payloads',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'preview-store-limit-'));roots.push(root);
    const store=new PreviewBundleStore(root,16);
    await expect(store.write('preview_2','index.html',[{path:'index.html',data:Buffer.alloc(17),mimeType:'text/html'}])).rejects.toThrow('exceeds');
  });
});
