import {describe,expect,it} from 'vitest';
import type {Message,Run} from '@agenvyl/contracts';
import {autoRoutingCandidates} from './autoRoutingCandidates';

const author={profileId:'local-user',displayName:'User',handle:'user'};
const message=(id:string):Message=>({id,text:'Request',createdAt:'2026-08-14T00:00:00.000Z',targets:[],runIds:[],attachments:[],author,addressedToAll:false});
const run=(id:string,messageId:string,agent:string,status:Run['status']='completed'):Run=>({
  id,messageId,agent,harnessInstanceId:'local-codex',harnessType:'codex',modelId:'gpt-5',
  executionProfile:{workflowMode:'work',requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:null,agentVariantId:null},
  status,text:'Answer',tools:[],interventions:[],responseSlotId:`slot-${id}`,
});

describe('autoRoutingCandidates',()=>{
  it('returns every distinct active agent before completed candidates',()=>{
    const runs={old:run('old','message-1','reviewer'),activeCoder:run('activeCoder','message-2','coder','streaming'),activeReviewer:run('activeReviewer','message-3','reviewer','waiting_clarification'),newerCoder:run('newerCoder','message-4','coder','queued')};
    expect(autoRoutingCandidates({messages:[message('message-1')],runs,runOrder:Object.keys(runs),selectedRuns:{'slot-old':'old'}})).toEqual(['coder','reviewer']);
  });

  it('uses selected responses from the latest completed round',()=>{
    const runs={older:run('older','message-1','architect'),coder:run('coder','message-2','coder'),reviewer:run('reviewer','message-2','reviewer')};
    expect(autoRoutingCandidates({messages:[message('message-1'),message('message-2')],runs,runOrder:Object.keys(runs),selectedRuns:{'slot-older':'older','slot-coder':'coder','slot-reviewer':'reviewer'}})).toEqual(['coder','reviewer']);
  });

  it('ignores failed and unselected responses',()=>{
    const runs={failed:run('failed','message-2','coder','failed'),unselected:run('unselected','message-2','reviewer')};
    expect(autoRoutingCandidates({messages:[message('message-2')],runs,runOrder:Object.keys(runs),selectedRuns:{}})).toEqual([]);
  });
});
