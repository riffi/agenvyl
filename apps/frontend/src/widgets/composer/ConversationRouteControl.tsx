import {useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,GitBranch} from 'lucide-react';
import type {ConversationRoutingMode} from '@agenvyl/contracts';
import type {Persona} from '../../entities/persona';
import styles from './Composer.module.css';

export type RouteDelivery='after_response'|'apply_now'|'new_request';

export function ConversationRouteControl({mode,target,delivery,personas,saving,applyAvailable,onModeChange,onTargetChange,onDeliveryChange}:{mode:ConversationRoutingMode;target?:string;delivery:RouteDelivery;personas:Persona[];saving:boolean;applyAvailable:boolean;onModeChange:(mode:ConversationRoutingMode)=>void;onTargetChange:(target:string|undefined)=>void;onDeliveryChange:(delivery:RouteDelivery)=>void}){
  const[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const close=(event:KeyboardEvent|PointerEvent)=>{if(event instanceof KeyboardEvent&&event.key!=='Escape')return;if(event instanceof PointerEvent&&root.current?.contains(event.target as Node))return;setOpen(false)};document.addEventListener('keydown',close);document.addEventListener('pointerdown',close);return()=>{document.removeEventListener('keydown',close);document.removeEventListener('pointerdown',close)}},[open]);
  const label=mode==='room_context'?'Room context':mode==='agent_session'?(target?`Reply · @${target}`:'Agent session'):'Auto';
  return <div className={styles['route-control']} ref={root}>
    <button type="button" className={styles['route-button']} aria-haspopup="dialog" aria-expanded={open} disabled={saving} onClick={()=>setOpen(value=>!value)}><GitBranch aria-hidden="true"/><span>{label}</span><ChevronDown aria-hidden="true"/></button>
    {open&&<section className={styles['route-popover']} role="dialog" aria-label="Message route">
      <header><strong>Message route</strong><small>The system will show what happened under your message.</small></header>
      <div className={styles['route-modes']} role="group" aria-label="Conversation routing mode">
        {([['auto','Auto','Follow the current agent when there is one clear recipient.'],['room_context','Room context','Start a new request with the room’s trimmed history.'],['agent_session','Agent session','Continue one agent’s native session.']] as const).map(([value,title,description])=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>onModeChange(value)}><span>{mode===value?<Check aria-hidden="true"/>:null}</span><strong>{title}</strong><small>{description}</small></button>)}
      </div>
      {(mode==='agent_session'||target)&&<label className={styles['route-field']}><span>Agent</span><select aria-label="Agent session recipient" value={target??''} onChange={event=>onTargetChange(event.target.value||undefined)}><option value="">Choose an agent…</option>{personas.map(persona=><option value={persona.handle} key={persona.id}>@{persona.handle} · {persona.name}</option>)}</select></label>}
      {mode!=='room_context'&&<fieldset className={styles['delivery-options']}><legend>When</legend>
        <label><input type="radio" name="route-delivery" checked={delivery==='after_response'} onChange={()=>onDeliveryChange('after_response')}/><span><strong>After response</strong><small>Wait if the agent is still responding.</small></span></label>
        <label title={applyAvailable?'Interrupt the active response now':'Available only for a streaming agent that supports interruption'}><input type="radio" name="route-delivery" checked={delivery==='apply_now'} disabled={!applyAvailable} onChange={()=>onDeliveryChange('apply_now')}/><span><strong>Apply now</strong><small>{applyAvailable?'Redirect the active response.':'Unavailable for the selected agent.'}</small></span></label>
        {mode==='auto'&&<label><input type="radio" name="route-delivery" checked={delivery==='new_request'} onChange={()=>onDeliveryChange('new_request')}/><span><strong>New request</strong><small>Use room context instead of a session.</small></span></label>}
      </fieldset>}
    </section>}
  </div>;
}
