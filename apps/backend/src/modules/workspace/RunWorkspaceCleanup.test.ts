import {describe,expect,it,vi} from 'vitest';
import {RunWorkspaceCleanup} from './RunWorkspaceCleanup.js';

describe('RunWorkspaceCleanup',()=>{
  it('retries a deferred Windows cleanup without blocking finalization',async()=>{
    vi.useFakeTimers();
    const remove=vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('resource busy or locked'),{code:'EBUSY'}))
      .mockResolvedValue(undefined);
    const logger={info:vi.fn(),warn:vi.fn()};
    const cleanup=new RunWorkspaceCleanup(remove,logger,[25]);
    const task={roomId:'room-1',runId:'run-1',phase:'finalization' as const};

    try{
      await expect(cleanup.removeOrDefer(task)).resolves.toBe(false);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({retryAttempt:1,retryInMs:25}),'Run workspace cleanup deferred');

      await vi.advanceTimersByTimeAsync(25);

      expect(remove).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({retryAttempts:1}),'Deferred run workspace cleanup completed');
    }finally{
      cleanup.close();
      vi.useRealTimers();
    }
  });

  it('keeps retrying at the capped delay until the handle is released',async()=>{
    vi.useFakeTimers();
    const remove=vi.fn()
      .mockRejectedValueOnce(new Error('busy'))
      .mockRejectedValueOnce(new Error('still busy'))
      .mockResolvedValue(undefined);
    const cleanup=new RunWorkspaceCleanup(remove,undefined,[10]);
    const task={roomId:'room-1',runId:'run-1',phase:'recovery' as const};

    try{
      await cleanup.removeOrDefer(task);
      await vi.advanceTimersByTimeAsync(20);
      expect(remove).toHaveBeenCalledTimes(3);
    }finally{
      cleanup.close();
      vi.useRealTimers();
    }
  });

  it('cancels pending retries when the service closes',async()=>{
    vi.useFakeTimers();
    const remove=vi.fn().mockRejectedValue(new Error('busy'));
    const cleanup=new RunWorkspaceCleanup(remove,undefined,[10]);

    try{
      await cleanup.removeOrDefer({roomId:'room-1',runId:'run-1',phase:'recovery'});
      cleanup.close();
      await vi.advanceTimersByTimeAsync(20);
      expect(remove).toHaveBeenCalledTimes(1);
    }finally{
      cleanup.close();
      vi.useRealTimers();
    }
  });

  it('stops scheduling retries after durable quarantine',async()=>{
    vi.useFakeTimers();
    const remove=vi.fn().mockRejectedValue(new Error('busy')),deferred=vi.fn().mockResolvedValue('quarantine' as const);
    const cleanup=new RunWorkspaceCleanup(remove,undefined,[10],{deferred});
    try{
      await expect(cleanup.removeOrDefer({roomId:'room-1',runId:'run-1',phase:'recovery'})).resolves.toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(deferred).toHaveBeenCalledWith(expect.objectContaining({runId:'run-1'}),expect.any(Error),1,10);
    }finally{
      cleanup.close();
      vi.useRealTimers();
    }
  });
});
