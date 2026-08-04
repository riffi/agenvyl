import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {pickLocalDirectory,validateLocalDirectory} from './directory-access.js';

const cleanups:string[]=[];
afterEach(async()=>{await Promise.all(cleanups.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

describe('local directory access',()=>{
  it('canonicalizes existing folders and rejects missing or file targets',async()=>{
    const root=await mkdtemp(join(tmpdir(),'agenvyl-project-'));cleanups.push(root);
    const file=join(root,'file.txt');await writeFile(file,'x');
    await expect(validateLocalDirectory(root)).resolves.toMatchObject({status:'available',path:root,pathKey:expect.any(String)});
    await expect(validateLocalDirectory(file)).resolves.toMatchObject({status:'unavailable'});
    await expect(validateLocalDirectory(join(root,'missing'))).resolves.toMatchObject({status:'unavailable'});
    await expect(validateLocalDirectory('relative/path')).resolves.toMatchObject({status:'unavailable',error:{code:'directory_invalid'}});
  });

  it.each([
    ['win32','powershell.exe'],['darwin','/usr/bin/osascript'],['linux','zenity'],
  ] as const)('uses the platform picker on %s',async(platform,expected)=>{
    const root=await mkdtemp(join(tmpdir(),'agenvyl-picked-'));cleanups.push(root);
    const runner=vi.fn(async()=>({stdout:`${root}\n`}));
    await expect(pickLocalDirectory(platform,runner)).resolves.toEqual({status:'selected',path:root});
    expect(runner.mock.calls[0]?.[0]).toBe(expected);
  });

  it('falls back from zenity to kdialog and treats cancellation as non-error',async()=>{
    const missing=Object.assign(new Error('missing'),{code:'ENOENT'}),runner=vi.fn().mockRejectedValueOnce(missing).mockRejectedValueOnce(Object.assign(new Error('cancel'),{code:1}));
    await expect(pickLocalDirectory('linux',runner)).resolves.toEqual({status:'cancelled'});
    expect(runner.mock.calls.map(call=>call[0])).toEqual(['zenity','kdialog']);
  });
});
