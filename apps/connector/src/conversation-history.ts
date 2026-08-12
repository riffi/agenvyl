import type {CanonicalConversationItem} from '@agenvyl/connector-contract';

export const EXPERIMENTAL_TAIL_V1_HISTORY_POLICY = 'tail-v1' as const;
export const EXPERIMENTAL_TAIL_V1_ITEM_CHAR_LIMIT = 16_000;
export const EXPERIMENTAL_TAIL_V1_JSON_CHAR_LIMIT = 48_000;

export type ExperimentalTailV1ConversationHistory = {
  history:CanonicalConversationItem[];
  historyPolicy:typeof EXPERIMENTAL_TAIL_V1_HISTORY_POLICY;
  historyItemsTotal:number;
  historyItemsIncluded:number;
  historyItemsDropped:number;
  historyJsonChars:number;
};

export const experimentalTailV1ConversationHistory=(source:readonly CanonicalConversationItem[]):ExperimentalTailV1ConversationHistory=>{
  const history:CanonicalConversationItem[]=[];
  let historyJsonChars=0;
  for(let index=source.length-1;index>=0;index--){
    const item=source[index]!;
    const candidate:CanonicalConversationItem={role:item.role,content:item.content.slice(0,EXPERIMENTAL_TAIL_V1_ITEM_CHAR_LIMIT)};
    const candidateJsonChars=JSON.stringify(candidate).length;
    if(historyJsonChars+candidateJsonChars>EXPERIMENTAL_TAIL_V1_JSON_CHAR_LIMIT)break;
    history.unshift(candidate);
    historyJsonChars+=candidateJsonChars;
  }
  return{
    history,
    historyPolicy:EXPERIMENTAL_TAIL_V1_HISTORY_POLICY,
    historyItemsTotal:source.length,
    historyItemsIncluded:history.length,
    historyItemsDropped:source.length-history.length,
    historyJsonChars,
  };
};
