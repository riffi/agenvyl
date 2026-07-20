import { useEffect, useReducer } from 'react';
import type { RoomEventStream } from '../../../shared/api/realtime';
import { initialState,prependTimeline,roomReducer,stateFromTimeline,type RoomEvent,type TimelinePage } from './roomState';

type Action={type:'reset'}|{type:'snapshot';page:TimelinePage}|{type:'prepend';page:TimelinePage}|RoomEvent;
export function useRoomStream(stream: RoomEventStream<RoomEvent>,snapshot?:TimelinePage,subscribeWithoutSnapshot=false) {
  const [state, dispatch] = useReducer(
    (current: typeof initialState, action:Action) => action.type === 'reset'?{...initialState}:action.type==='snapshot'?stateFromTimeline(action.page):action.type==='prepend'?prependTimeline(current,action.page):roomReducer(current,action),
    initialState,
  );
  useEffect(() => {
    let active = true;
    if(snapshot)dispatch({type:'snapshot',page:snapshot});else dispatch({ type: 'reset' });
    if(!snapshot&&!subscribeWithoutSnapshot)return;
    const unsubscribe = stream.subscribe((event) => { if (active) dispatch(event); });
    return () => { active = false; unsubscribe(); };
  }, [stream,snapshot,subscribeWithoutSnapshot]);
  return{state,prepend:(page:TimelinePage)=>dispatch({type:'prepend',page})};
}
