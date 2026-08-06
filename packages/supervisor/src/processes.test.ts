import {afterEach,describe,expect,it,vi} from 'vitest';
import {isProcessAlive} from './processes.js';

afterEach(()=>vi.restoreAllMocks());

describe('isProcessAlive',()=>{
  it('reports a process as alive when the signal probe succeeds',()=>{
    vi.spyOn(process,'kill').mockReturnValue(true);
    expect(isProcessAlive(123)).toBe(true);
  });

  it.each(['EPERM','EACCES'])('treats %s as an existing process without signal permission',code=>{
    vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error(code),{code})});
    expect(isProcessAlive(123)).toBe(true);
  });

  it('treats ESRCH as a stopped process',()=>{
    vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('ESRCH'),{code:'ESRCH'})});
    expect(isProcessAlive(123)).toBe(false);
  });

  it('rejects invalid process identifiers without probing',()=>{
    const probe=vi.spyOn(process,'kill');
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(Number.NaN)).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
});
