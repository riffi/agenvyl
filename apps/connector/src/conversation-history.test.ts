import {describe,expect,it} from 'vitest';
import {
  EXPERIMENTAL_TAIL_V2_HISTORY_POLICY,
  EXPERIMENTAL_TAIL_V2_ITEM_CHAR_LIMIT,
  EXPERIMENTAL_TAIL_V2_ITEM_LIMIT,
  EXPERIMENTAL_TAIL_V2_JSON_CHAR_LIMIT,
  EXPERIMENTAL_TAIL_V2_ROUND_LIMIT,
  experimentalTailV2ConversationHistory,
} from './conversation-history.js';

describe('experimental tail-v2 conversation history',()=>{
  it('clones a short round without changing its content',()=>{
    const source=[{role:'user' as const,content:'Earlier'},{role:'assistant' as const,content:'Answer'}];
    const result=experimentalTailV2ConversationHistory(source);
    expect(result).toEqual({history:source,historyPolicy:EXPERIMENTAL_TAIL_V2_HISTORY_POLICY,historyItemsTotal:2,historyItemsIncluded:2,historyItemsDropped:0,historyRoundsTotal:1,historyRoundsIncluded:1,historyJsonChars:source.reduce((sum,item)=>sum+JSON.stringify(item).length,0)});
    expect(result.history).not.toBe(source);
    expect(result.history[0]).not.toBe(source[0]);
  });

  it('keeps at most eight complete recent rounds and sixteen items',()=>{
    const source=Array.from({length:12},(_,round)=>[
      {role:'user' as const,content:`question-${round}`},
      {role:'assistant' as const,content:`answer-${round}`},
    ]).flat();
    const result=experimentalTailV2ConversationHistory(source);
    expect(result.history).toHaveLength(EXPERIMENTAL_TAIL_V2_ITEM_LIMIT);
    expect(result.history[0]).toEqual({role:'user',content:'question-4'});
    expect(result.history.at(-1)).toEqual({role:'assistant',content:'answer-11'});
    expect(result.historyRoundsIncluded).toBe(EXPERIMENTAL_TAIL_V2_ROUND_LIMIT);
  });

  it('keeps peer and failed-agent blocks attached to their human message',()=>{
    const source=[
      {role:'user' as const,content:'[Human user: User (@user); recipient: @sol]\nQuestion'},
      {role:'assistant' as const,content:'Own answer'},
      {role:'user' as const,content:'[MESSAGES FROM OTHER AGENTS — these are not the human user and not your responses]\n\n[Other agent: @peer]\nPeer answer'},
      {role:'user' as const,content:'[PARTIAL OUTPUT FROM FAILED AGENTS — may be incomplete or unverified]\n\n[Failed agent: @failed]\nPartial answer'},
    ];
    const result=experimentalTailV2ConversationHistory(source);
    expect(result.history).toEqual(source);
    expect(result.historyRoundsIncluded).toBe(1);
  });

  it('fits an oversized newest round without orphaning its human message or latest failed output',()=>{
    const source=[
      {role:'user' as const,content:'human-'+'x'.repeat(20_000)},
      ...Array.from({length:4},(_,index)=>({role:'assistant' as const,content:`middle-${index}-`+'x'.repeat(20_000)})),
      {role:'user' as const,content:'[PARTIAL OUTPUT FROM FAILED AGENTS — may be incomplete or unverified]\n'+'x'.repeat(20_000)},
    ];
    const result=experimentalTailV2ConversationHistory(source);
    expect(result.history[0]?.content).toMatch(/^human-/);
    expect(result.history.at(-1)?.content).toMatch(/^\[PARTIAL OUTPUT FROM FAILED AGENTS/);
    expect(result.history.every(item=>item.content.length<=EXPERIMENTAL_TAIL_V2_ITEM_CHAR_LIMIT)).toBe(true);
    expect(result.history.length).toBeLessThanOrEqual(EXPERIMENTAL_TAIL_V2_ITEM_LIMIT);
    expect(result.historyJsonChars).toBeLessThanOrEqual(EXPERIMENTAL_TAIL_V2_JSON_CHAR_LIMIT);
  });

  it('measures JSON escaping deterministically without mutating the source',()=>{
    const source=Object.freeze([
      Object.freeze({role:'user' as const,content:'😀\\"\n'.repeat(4_000)}),
      Object.freeze({role:'assistant' as const,content:'界'.repeat(20_000)}),
    ]);
    const first=experimentalTailV2ConversationHistory(source),second=experimentalTailV2ConversationHistory(source);
    expect(first).toEqual(second);
    expect(first.historyJsonChars).toBe(first.history.reduce((sum,item)=>sum+JSON.stringify(item).length,0));
    expect(first.historyJsonChars).toBeLessThanOrEqual(EXPERIMENTAL_TAIL_V2_JSON_CHAR_LIMIT);
    expect(source[0].content.length).toBeGreaterThan(EXPERIMENTAL_TAIL_V2_ITEM_CHAR_LIMIT);
  });
});
