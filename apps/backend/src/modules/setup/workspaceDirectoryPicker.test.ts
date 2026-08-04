import {describe,expect,it,vi} from 'vitest';
import {pickWorkspaceDirectory} from './workspaceDirectoryPicker.js';

describe('workspace directory picker',()=>{
  it('uses the macOS folder chooser and returns its selected path',async()=>{
    const runner=vi.fn().mockResolvedValue('/Users/test/Agenvyl Workspaces/\n');
    await expect(pickWorkspaceDirectory('darwin',runner)).resolves.toBe('/Users/test/Agenvyl Workspaces/');
    expect(runner).toHaveBeenCalledWith('osascript',expect.arrayContaining(['POSIX path of (choose folder with prompt "Choose Agenvyl workspace root")']));
  });

  it('uses a single-threaded Windows folder dialog',async()=>{
    const runner=vi.fn().mockResolvedValue('C:\\Workspaces\r\n');
    await expect(pickWorkspaceDirectory('win32',runner)).resolves.toBe('C:\\Workspaces');
    expect(runner).toHaveBeenCalledWith('powershell.exe',expect.arrayContaining(['-STA']));
  });

  it('falls back from Zenity to KDialog on Linux',async()=>{
    const missing=Object.assign(new Error('missing'),{code:'ENOENT'});
    const runner=vi.fn().mockRejectedValueOnce(missing).mockResolvedValueOnce('/home/test/workspaces\n');
    await expect(pickWorkspaceDirectory('linux',runner)).resolves.toBe('/home/test/workspaces');
    expect(runner.mock.calls.map(call=>call[0])).toEqual(['zenity','kdialog']);
  });

  it('returns no path when the dialog is cancelled',async()=>{
    await expect(pickWorkspaceDirectory('darwin',vi.fn().mockResolvedValue('\n'))).resolves.toBeUndefined();
  });
});
