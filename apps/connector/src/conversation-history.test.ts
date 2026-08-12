import {describe,expect,it} from 'vitest';
import {
  EXPERIMENTAL_TAIL_V1_HISTORY_POLICY,
  EXPERIMENTAL_TAIL_V1_ITEM_CHAR_LIMIT,
  EXPERIMENTAL_TAIL_V1_JSON_CHAR_LIMIT,
  experimentalTailV1ConversationHistory,
} from './conversation-history.js';

describe('experimental tail-v1 conversation history',()=>{
  it('clones a short history without changing its content',()=>{
    const source=[{role:'user' as const,content:'Earlier'},{role:'assistant' as const,content:'Answer'}];
    const result=experimentalTailV1ConversationHistory(source);
    expect(result).toEqual({history:source,historyPolicy:EXPERIMENTAL_TAIL_V1_HISTORY_POLICY,historyItemsTotal:2,historyItemsIncluded:2,historyItemsDropped:0,historyJsonChars:source.reduce((sum,item)=>sum+JSON.stringify(item).length,0)});
    expect(result.history).not.toBe(source);
    expect(result.history[0]).not.toBe(source[0]);
  });

  it('keeps the newest continuous tail in original role order',()=>{
    const source=Array.from({length:5},(_,index)=>({role:index%2?'assistant' as const:'user' as const,content:`item-${index}-`+'x'.repeat(12_000)}));
    const result=experimentalTailV1ConversationHistory(source);
    expect(result.history.map(item=>item.content.slice(0,6))).toEqual(['item-2','item-3','item-4']);
    expect(result.history.map(item=>item.role)).toEqual(['user','assistant','user']);
    expect(result.historyItemsDropped).toBe(2);
  });

  it('limits every included item to 16,000 JS characters',()=>{
    const result=experimentalTailV1ConversationHistory([{role:'user',content:'x'.repeat(20_000)}]);
    expect(result.history[0]?.content).toHaveLength(EXPERIMENTAL_TAIL_V1_ITEM_CHAR_LIMIT);
  });

  it('measures JSON escaping and Unicode deterministically within the 48,000 character budget',()=>{
    const source=[
      {role:'user' as const,content:'😀\\"\n'.repeat(4_000)},
      {role:'assistant' as const,content:'界'.repeat(16_000)},
      {role:'user' as const,content:'latest'},
    ];
    const first=experimentalTailV1ConversationHistory(source),second=experimentalTailV1ConversationHistory(source);
    expect(first).toEqual(second);
    expect(first.historyJsonChars).toBe(first.history.reduce((sum,item)=>sum+JSON.stringify(item).length,0));
    expect(first.historyJsonChars).toBeLessThanOrEqual(EXPERIMENTAL_TAIL_V1_JSON_CHAR_LIMIT);
  });

  it('does not mutate the source array or items',()=>{
    const source=Object.freeze([Object.freeze({role:'user' as const,content:'x'.repeat(20_000)})]);
    expect(()=>experimentalTailV1ConversationHistory(source)).not.toThrow();
    expect(source[0].content).toHaveLength(20_000);
  });
});
