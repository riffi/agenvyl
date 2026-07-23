import type {RunExecutionProfileSnapshot} from '@agenvyl/contracts';
import {AppError} from '../../shared/errors/AppError.js';

export type FeatureFlags={planMode:boolean};

export const assertPlanModeEnabled=(enabled:boolean|undefined)=>{
  if(enabled===false)throw new AppError('plan_mode_disabled',409,'Plan Mode is disabled');
};

export const usesPlanWorkflow=(profile:RunExecutionProfileSnapshot)=>
  profile.workflowMode==='plan'||profile.implementationPlanVersionId!==null;
