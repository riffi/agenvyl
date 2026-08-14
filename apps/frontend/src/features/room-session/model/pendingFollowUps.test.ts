import {describe,expect,it} from 'vitest';
import type {Message} from '../../../entities/message';
import {isPendingFollowUp} from './pendingFollowUps';

const message:Message={id:'message',text:'Continue',createdAt:'2026-08-14T00:00:00.000Z',targets:['coder'],runIds:[],attachments:[],author:{profileId:'local-user',displayName:'User',handle:'user'},addressedToAll:false};

describe('isPendingFollowUp',()=>{
  it('keeps queued and dispatching session messages in the composer shelf',()=>{
    expect(isPendingFollowUp({...message,delivery:{route:'agent_session',status:'queued'}})).toBe(true);
    expect(isPendingFollowUp({...message,delivery:{route:'active_intervention',status:'dispatching'}})).toBe(true);
  });

  it('returns delivered messages to the timeline',()=>{
    expect(isPendingFollowUp({...message,delivery:{route:'active_intervention',status:'applied'}})).toBe(false);
    expect(isPendingFollowUp({...message,delivery:{route:'agent_session',status:'continued'}})).toBe(false);
    expect(isPendingFollowUp({...message,delivery:{route:'room_context',status:'delivered'}})).toBe(false);
  });
});
