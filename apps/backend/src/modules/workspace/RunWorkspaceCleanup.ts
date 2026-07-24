export type RunWorkspaceCleanupTask={
  roomId:string;
  runId:string;
  phase:'recovery'|'finalization';
};

type WorkspaceCleanupLogger={
  info:(context:Record<string,unknown>,message:string)=>void;
  warn:(context:Record<string,unknown>,message:string)=>void;
};

type WorkspaceCleanupObserver={
  complete?:(task:RunWorkspaceCleanupTask)=>Promise<void>;
  deferred?:(task:RunWorkspaceCleanupTask,error:unknown,attempt:number,delayMs:number)=>Promise<'retry'|'quarantine'>;
};

const defaultRetryDelays=[1_000,3_000,10_000,30_000,60_000];

export class RunWorkspaceCleanup{
  private pending=new Map<string,ReturnType<typeof setTimeout>|undefined>();
  private closed=false;

  constructor(
    private readonly remove:(task:RunWorkspaceCleanupTask)=>Promise<void>,
    private readonly logger?:WorkspaceCleanupLogger,
    private readonly retryDelays=defaultRetryDelays,
    private readonly observer?:WorkspaceCleanupObserver,
  ){
    if(!retryDelays.length)throw new Error('Workspace cleanup requires at least one retry delay');
  }

  async removeOrDefer(task:RunWorkspaceCleanupTask){
    if(this.closed)return false;
    const key=taskKey(task);
    if(this.pending.has(key))return false;
    try{
      await this.remove(task);
      await this.observer?.complete?.(task).catch(()=>{});
      return true;
    }catch(error){
      await this.schedule(task,0,error);
      return false;
    }
  }

  close(){
    this.closed=true;
    for(const timer of this.pending.values())if(timer)clearTimeout(timer);
    this.pending.clear();
  }

  private async schedule(task:RunWorkspaceCleanupTask,attempt:number,error:unknown){
    const key=taskKey(task);
    if(this.closed){this.pending.delete(key);return;}
    const delay=this.retryDelays[Math.min(attempt,this.retryDelays.length-1)]!;
    const decision=await this.observer?.deferred?.(task,error,attempt+1,delay).catch(()=>'retry' as const)??'retry';
    this.logger?.warn({
      metric:'workspace.cleanup',
      roomId:task.roomId,
      runId:task.runId,
      phase:task.phase,
      retryAttempt:attempt+1,
      retryInMs:delay,
      outcome:decision,
      error:error instanceof Error?error.message:String(error),
    },'Run workspace cleanup deferred');
    if(decision==='quarantine'){
      this.pending.delete(key);
      return;
    }
    const timer=setTimeout(()=>{
      this.pending.set(key,undefined);
      void this.retry(task,attempt+1);
    },delay);
    timer.unref?.();
    this.pending.set(key,timer);
  }

  private async retry(task:RunWorkspaceCleanupTask,attempt:number){
    try{
      await this.remove(task);
      this.pending.delete(taskKey(task));
      await this.observer?.complete?.(task).catch(()=>{});
      this.logger?.info({
        metric:'workspace.cleanup',
        roomId:task.roomId,
        runId:task.runId,
        phase:task.phase,
        retryAttempts:attempt,
      },'Deferred run workspace cleanup completed');
    }catch(error){
      await this.schedule(task,attempt,error);
    }
  }
}

const taskKey=(task:RunWorkspaceCleanupTask)=>`${task.roomId}\0${task.runId}`;
