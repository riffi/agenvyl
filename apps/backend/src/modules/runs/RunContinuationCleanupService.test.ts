import {describe,expect,it,vi} from 'vitest';
import {RunContinuationCleanupService} from './RunContinuationCleanupService.js';

describe('RunContinuationCleanupService',()=>{
  it.each(['released','provider_retained','not_found'] as const)('persists the %s release outcome',async outcome=>{
    const runs={pendingContinuationReleases:vi.fn(async()=>[{rootRunId:'root',instanceId:'instance',handle:'private',retention:'explicit_release' as const}]),markContinuationReleased:vi.fn(),invalidateContinuations:vi.fn()},gateway={releaseContinuation:vi.fn(async()=>outcome)},service=new RunContinuationCleanupService({runs,gateway} as never);
    await service.invalidateRoom('room');
    expect(runs.invalidateContinuations).toHaveBeenCalledWith('room');
    expect(runs.markContinuationReleased).toHaveBeenCalledWith('root',outcome);
  });

  it('records transport failures without blocking invalidation',async()=>{
    const runs={pendingContinuationReleases:vi.fn(async()=>[{rootRunId:'root',instanceId:'instance',handle:'private',retention:'explicit_release' as const}]),markContinuationReleased:vi.fn(),invalidateContinuations:vi.fn()},gateway={releaseContinuation:vi.fn(async()=>{throw new Error('offline');})},service=new RunContinuationCleanupService({runs,gateway} as never);
    await expect(service.invalidateRoom('room')).resolves.toBeUndefined();
    expect(runs.markContinuationReleased).toHaveBeenCalledWith('root','release_failed','offline');
  });

  it('drains cleanup requested while another release pass is active',async()=>{
    let unblock:(value:'released')=>void=()=>{};
    const firstRelease=new Promise<'released'>(resolve=>{unblock=resolve;});
    const pending=vi.fn().mockResolvedValueOnce([{rootRunId:'first',instanceId:'instance',handle:'one',retention:'explicit_release'}]).mockResolvedValueOnce([{rootRunId:'second',instanceId:'instance',handle:'two',retention:'explicit_release'}]);
    const releaseContinuation=vi.fn(async(_instance:string,handle:string)=>handle==='one'?firstRelease:'released' as const),runs={pendingContinuationReleases:pending,markContinuationReleased:vi.fn()},service=new RunContinuationCleanupService({runs,gateway:{releaseContinuation}} as never);
    const first=service.reconcile();await vi.waitFor(()=>expect(releaseContinuation).toHaveBeenCalledWith('instance','one'));
    const concurrent=service.reconcile();unblock('released');await Promise.all([first,concurrent]);
    expect(releaseContinuation).toHaveBeenCalledWith('instance','two');
    expect(runs.markContinuationReleased).toHaveBeenCalledWith('second','released');
  });
});
