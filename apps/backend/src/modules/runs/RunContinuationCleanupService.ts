import type {RunGateway} from '../harness/harness.ports.js';
import type {RunRepository} from './runs.repository.js';

export class RunContinuationCleanupService{
  private reconciliation?:Promise<void>;
  private reconciliationRequested=false;

  constructor(private readonly dependencies:{runs:RunRepository;gateway:RunGateway}){}

  async invalidateRoom(roomId:string){
    await this.dependencies.runs.invalidateContinuations(roomId);
    await this.reconcile();
  }

  async selected(roomId:string,runId:string){
    await this.dependencies.runs.invalidateOtherContinuations(roomId,runId);
    await this.reconcile();
  }

  reconcile(){
    this.reconciliationRequested=true;
    return this.reconciliation??=this.drain().finally(()=>{this.reconciliation=undefined;});
  }

  private async drain(){do{this.reconciliationRequested=false;await this.releasePending();}while(this.reconciliationRequested);}

  private async releasePending(){
    const pending=await this.dependencies.runs.pendingContinuationReleases();
    for(const item of pending){
      try{
        if(!this.dependencies.gateway.releaseContinuation)throw new Error('Connector continuation release is unavailable');
        const outcome=await this.dependencies.gateway.releaseContinuation(item.instanceId,item.handle);
        await this.dependencies.runs.markContinuationReleased(item.rootRunId,outcome);
      }catch(error){
        await this.dependencies.runs.markContinuationReleased(item.rootRunId,'release_failed',error instanceof Error?error.message:'Continuation release failed');
      }
    }
  }
}
