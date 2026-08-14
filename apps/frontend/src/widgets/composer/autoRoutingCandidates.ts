import type {RoomState} from '../../entities/room';

const activeStatuses=new Set(['queued','streaming','finalizing','stopping','waiting_approval','waiting_clarification']);

const uniqueHandles=(handles:Iterable<string>)=>[...new Set(handles)];

export const autoRoutingCandidates=(state:Pick<RoomState,'messages'|'runs'|'runOrder'|'selectedRuns'>):string[]=>{
  const active=uniqueHandles(state.runOrder.flatMap(id=>{
    const run=state.runs[id];
    return run&&activeStatuses.has(run.status)?[run.agent]:[];
  }));
  if(active.length)return active;

  const selectedIds=new Set(Object.values(state.selectedRuns));
  for(const message of [...state.messages].reverse()){
    const selected=uniqueHandles(state.runOrder.flatMap(id=>{
      const run=state.runs[id];
      return run&&run.messageId===message.id&&run.status==='completed'&&selectedIds.has(id)?[run.agent]:[];
    }));
    if(selected.length)return selected;
  }
  return [];
};
