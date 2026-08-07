import type {CreateRunInterventionResult} from '@agenvyl/contracts';
import type {RunGateway} from '../harness/harness.ports.js';
import {AppError} from '../../shared/errors/AppError.js';
import type {ActiveRunRegistry} from './ActiveRunRegistry.js';
import type {RunRepository} from './runs.repository.js';

export class RunInterventionService{
  constructor(private readonly dependencies:{runs:RunRepository;activeRuns:ActiveRunRegistry;gateway:RunGateway}){}

  async create(runId:string,input:{intervention_id:string;text:string}):Promise<CreateRunInterventionResult>{
    const control=await this.dependencies.runs.control(runId);
    if(!control)throw new AppError('not_found',404,'Run not found');
    const run=this.dependencies.activeRuns.get(runId);
    if(!run||run.terminal||control.status!=='streaming'||run.status!=='streaming')throw new AppError('run_not_intervenable',409,'Only an actively streaming run can be redirected');
    if(run.pendingRequests?.size)throw new AppError('run_waiting_for_user',409,'Resolve the pending agent request before redirecting this run');
    const text=input.text.trim();
    if(run.pendingIntervention){
      if(run.pendingIntervention.id===input.intervention_id&&run.pendingIntervention.text===text)return{intervention_id:input.intervention_id,status:'pending'};
      throw new AppError(run.pendingIntervention.id===input.intervention_id?'intervention_conflict':'intervention_in_progress',409,run.pendingIntervention.id===input.intervention_id?'Intervention ID is already used with different text':'Another redirect is already in progress');
    }
    if(!this.dependencies.gateway.intervene)throw new AppError('intervention_unsupported',409,'This harness does not support redirecting active runs');
    const executionId=run.connectorExecutionId??run.upstreamRunId;
    if(!executionId)throw new AppError('run_not_intervenable',409,'The active run has no redirectable execution');
    let result:Awaited<ReturnType<NonNullable<RunGateway['intervene']>>>;
    try{result=await this.dependencies.gateway.intervene(executionId,{interventionId:input.intervention_id,text});}
    catch(error){
      const issue=error as {code?:unknown;status?:unknown;serverCode?:unknown;message?:unknown};
      if(issue.code==='connector_command_rejected')throw new AppError(typeof issue.serverCode==='string'?issue.serverCode:'intervention_rejected',typeof issue.status==='number'?issue.status:409,typeof issue.message==='string'?issue.message:'Connector rejected the redirect');
      throw error;
    }
    if(result.status==='pending')run.pendingIntervention={id:input.intervention_id,text};
    return{intervention_id:input.intervention_id,status:'pending'};
  }
}
