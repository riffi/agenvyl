import {describe,expect,it,vi} from 'vitest';
import {resolveCommand} from './command.js';

describe('Windows command lookup order',()=>{
  it.each(['cmd','bat'])('keeps an earlier .%s shim ahead of a later executable',async extension=>{
    const shim=`C:\\npm\\codex.${extension}`;
    const execute=vi.fn(async()=>({stdout:`C:\\npm\\codex\r\nC:\\npm\\codex.ps1\r\n${shim}\r\nC:\\old-codex\\codex.exe\r\n`,stderr:''}));
    await expect(resolveCommand('codex',{platform:'win32',env:{},execute})).resolves.toBe(shim);
    expect(execute).toHaveBeenCalledWith('where.exe',['codex'],expect.any(Object));
  });

  it('keeps an earlier native executable ahead of a later shim',async()=>{
    const execute=vi.fn(async()=>({stdout:'C:\\first\\codex.EXE\r\nC:\\npm\\codex.cmd\r\n',stderr:''}));
    await expect(resolveCommand('codex',{platform:'win32',env:{},execute})).resolves.toBe('C:\\first\\codex.EXE');
  });
});
