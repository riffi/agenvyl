import {describe,expect,it} from 'vitest';
import {inspectManagedProcess} from './managed-server-ownership.js';
import {spawnInWindowsJob} from './windows-job-object.js';

describe('Windows managed process Job Object',()=>{
  it.skipIf(process.platform!=='win32')('kills the managed process when the watchdog handle closes',async()=>{
    const launched=spawnInWindowsJob({file:process.execPath,args:['-e','setInterval(()=>{},1000)']},process.env);
    const pid=await launched.pid;
    expect(await inspectManagedProcess(pid,'win32')).toBeDefined();
    launched.child.kill();
    const deadline=Date.now()+5_000;
    while(Date.now()<deadline&&await inspectManagedProcess(pid,'win32'))await new Promise(resolve=>setTimeout(resolve,50));
    expect(await inspectManagedProcess(pid,'win32')).toBeUndefined();
  },15_000);
});
