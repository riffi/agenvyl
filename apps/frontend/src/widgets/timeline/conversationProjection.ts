import type {Message} from '../../entities/message';
import type {Run} from '../../entities/run';
import {isPendingFollowUp} from '../../features/room-session';

export const conversationProjection=(messages:Message[],runs:Record<string,Run>)=>{
  const routedInterventionIds=new Set(messages.filter(message=>message.delivery?.route==='active_intervention').map(message=>message.id));
  const embeddedInterventionIds=new Set(messages.filter(message=>{
    const delivery=message.delivery;
    if(delivery?.route!=='active_intervention'||isPendingFollowUp(message)||!delivery.anchorRunId)return false;
    return Boolean(runs[delivery.anchorRunId]?.interventions.some(intervention=>intervention.id===message.id));
  }).map(message=>message.id));
  const hiddenInterventionIds=new Set([...routedInterventionIds].filter(id=>!embeddedInterventionIds.has(id)));
  return{
    messages:messages.filter(message=>!isPendingFollowUp(message)&&!embeddedInterventionIds.has(message.id)),
    hiddenInterventionIds,
    routedInterventionIds,
  };
};
