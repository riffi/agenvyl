import type {HarnessCatalog} from '../../entities/harness';
import type {Run} from '../../entities/run';
import type {ComposerInterventionTarget} from '../composer';

export const instructionTargetMode=(run:Run,catalog?:HarnessCatalog):ComposerInterventionTarget['mode']=>{
  const instance=catalog?.instances.find(item=>item.id===run.harnessInstanceId&&item.status!=='unavailable');
  if(run.status==='streaming'&&instance?.interventionMode==='interrupt_then_continue'&&!(run.requests??[]).some(request=>!request.resolved)&&!run.interventions.some(intervention=>intervention.status==='pending'))return'active_redirect';
  if(run.status==='completed'&&instance?.postTurnContinuation?.mode==='native_session')return'post_turn_continuation';
  return'unavailable';
};
