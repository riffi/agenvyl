import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {afterEach,describe,expect,it} from 'vitest';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {exactEntriesEqual,fingerprintMatches,probeStatCapability,scanWorkspaceTree} from './workspaceCapture.js';
import {directCaptureIgnoredDirectories} from './RunArtifactPolicy.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});

describe('workspace capture helpers',()=>{
  it('compares canonical snapshot entries independently of input order',()=>{
    const first=[{path:'b',kind:'file' as const,versionId:'v2'},{path:'a',kind:'directory' as const}];
    expect(exactEntriesEqual(first,[...first].reverse())).toBe(true);
    expect(exactEntriesEqual(first,[{...first[0],versionId:'other'},first[1]])).toBe(false);
  });

  it('rejects metadata matches inside the racy fence window',()=>{
    const cached={path:'a',versionId:'v1',size:1,mtimeNs:'10',ctimeNs:'9',deviceId:'1',fileId:'2'};
    const current={size:1,mtimeNs:'10',ctimeNs:'9',deviceId:'1',fileId:'2'};
    expect(fingerprintMatches(cached,current,'11')).toBe(true);
    expect(fingerprintMatches(cached,current,'10')).toBe(false);
    expect(fingerprintMatches(cached,{...current,ctimeNs:'12'},'20')).toBe(false);
  });

  it('requires every stat identity field to match',()=>{
    const cached={path:'a',versionId:'v1',size:1,mtimeNs:'10',ctimeNs:'9',deviceId:'1',fileId:'2'},current={size:1,mtimeNs:'10',ctimeNs:'9',deviceId:'1',fileId:'2'};
    for(const changed of [{size:2},{mtimeNs:'11'},{ctimeNs:'10'},{deviceId:'3'},{fileId:'4'}])expect(fingerprintMatches(cached,{...current,...changed},'20')).toBe(false);
  });

  it('falls back cleanly when a filesystem capability probe cannot run',async()=>{
    await expect(probeStatCapability(path.join(tmpdir(),`missing-stat-probe-${crypto.randomUUID()}`))).resolves.toEqual({supported:false,capabilityKey:'unsupported'});
  });

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
