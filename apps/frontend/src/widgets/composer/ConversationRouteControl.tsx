import {useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,GitBranch} from 'lucide-react';
import type {ConversationRoutingMode} from '@agenvyl/contracts';
import styles from './Composer.module.css';

type VisibleRoutingMode=Exclude<ConversationRoutingMode,'agent_session'>;

export function ConversationRouteControl({mode,saving,onModeChange}:{mode:VisibleRoutingMode;saving:boolean;onModeChange:(mode:VisibleRoutingMode)=>void}){
  const[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const close=(event:KeyboardEvent|PointerEvent)=>{if(event instanceof KeyboardEvent&&event.key!=='Escape')return;if(event instanceof PointerEvent&&root.current?.contains(event.target as Node))return;setOpen(false)};document.addEventListener('keydown',close);document.addEventListener('pointerdown',close);return()=>{document.removeEventListener('keydown',close);document.removeEventListener('pointerdown',close)}},[open]);
  const label=mode==='room_context'?'Room context':'Auto';
  return <div className={styles['route-control']} ref={root}>
    <button type="button" className={styles['route-button']} aria-haspopup="dialog" aria-expanded={open} disabled={saving} onClick={()=>setOpen(value=>!value)}><GitBranch aria-hidden="true"/><span>{label}</span><ChevronDown aria-hidden="true"/></button>
    {open&&<section className={styles['route-popover']} role="dialog" aria-label="Message route">
      <header><strong>Message route</strong><small>The system will show what happened under your message.</small></header>
      <div className={styles['route-modes']} role="group" aria-label="Conversation routing mode">
        {([['auto','Auto','Follow the current agent when there is one clear recipient.'],['room_context','Room context','Start a new request with the room’s trimmed history.']] as const).map(([value,title,description])=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>onModeChange(value)}><span>{mode===value?<Check aria-hidden="true"/>:null}</span><strong>{title}</strong><small>{description}</small></button>)}
      </div>
    </section>}
  </div>;
}
