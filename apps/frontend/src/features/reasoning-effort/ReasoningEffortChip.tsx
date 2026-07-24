import {useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronDown,RotateCcw} from 'lucide-react';
import type {RoomPersona} from '@agenvyl/contracts';
import type {HarnessCatalog,HarnessCatalogModel} from '../../entities/harness';
import styles from './ReasoningEffortChip.module.css';

export const roomPersonaModel=(participant:RoomPersona,catalog?:HarnessCatalog):HarnessCatalogModel|undefined=>
  catalog?.instances.find(instance=>instance.id===participant.persona.harness_instance_id)?.models.find(model=>model.id===participant.persona.model_id);

export const roomPersonaReasoning=(participant:RoomPersona,model?:HarnessCatalogModel)=>{
  const requested=participant.reasoning_effort_override??participant.persona.default_reasoning_effort??model?.defaultReasoningEffort??null;
  const source=participant.reasoning_effort_override!==null?'room_override':participant.persona.default_reasoning_effort!==null?'persona_default':model?.defaultReasoningEffort!=null?'model_default':'auto';
  const effective=source==='room_override'||source==='persona_default'
    ? model?.reasoningEfforts?.includes(requested??'')?requested:model?.defaultReasoningEffort??null
    : requested;
  return{requested,effective,source,fallback:requested!==effective};
};

export function ReasoningEffortChip({participant,catalog,onChange,disabled=false,appearance='standalone'}:{participant:RoomPersona;catalog?:HarnessCatalog;onChange?:(value:string|null)=>Promise<unknown>|unknown;disabled?:boolean;appearance?:'standalone'|'inline'}){
  const [open,setOpen]=useState(false),[saving,setSaving]=useState(false),[position,setPosition]=useState({left:0,top:0,placement:'top' as 'top'|'bottom'}),root=useRef<HTMLSpanElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLSpanElement>(null);
  const model=roomPersonaModel(participant,catalog),state=roomPersonaReasoning(participant,model),options=model?.reasoningEfforts??[];
  useLayoutEffect(()=>{if(!open)return;const place=()=>{const rect=trigger.current?.getBoundingClientRect();if(!rect)return;const width=210,gap=6,placement=rect.top>190?'top':'bottom';setPosition({left:Math.max(8,Math.min(window.innerWidth-width-8,rect.right-width)),top:placement==='top'?rect.top-gap:rect.bottom+gap,placement})},close=(event:PointerEvent)=>{const target=event.target as Node;if(!root.current?.contains(target)&&!menu.current?.contains(target))setOpen(false)};place();document.addEventListener('pointerdown',close);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{document.removeEventListener('pointerdown',close);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true)}},[open]);
  const choose=async(value:string|null)=>{if(!onChange)return;setSaving(true);try{await onChange(value);setOpen(false)}finally{setSaving(false)}};
  const label=state.effective??'Auto',inherited=participant.reasoning_effort_override===null;
  return <span ref={root} className={styles.root}>
    <button ref={trigger} type="button" className={`${styles.chip} ${appearance==='inline'?styles.inline:''} ${inherited?'':styles.overridden}`} disabled={disabled||saving||!onChange} aria-label={`Reasoning effort: ${label}${inherited?' (inherited)':' (room override)'}`} aria-haspopup="menu" aria-expanded={open} title={`${inherited?'Inherited':'Room override'} · ${state.source.replace('_',' ')}`} onClick={()=>setOpen(value=>!value)}>
      <span>{label}{inherited?'':'*'}{state.fallback?' ↘':''}</span><ChevronDown aria-hidden="true"/>
    </button>
    {open&&createPortal(<span ref={menu} className={styles.menu} data-placement={position.placement} style={{left:position.left,top:position.top}} role="menu">
      <span className={styles.heading}>Reasoning effort</span>
      <button type="button" role="menuitemradio" aria-checked={inherited} onClick={()=>void choose(null)}>
        <RotateCcw/><span><strong>Like persona</strong><small>{participant.persona.default_reasoning_effort??model?.defaultReasoningEffort??'Auto'}</small></span>{inherited&&<Check/>}
      </button>
      {options.map(option=><button key={option} type="button" role="menuitemradio" aria-checked={participant.reasoning_effort_override===option} onClick={()=>void choose(option)}>
        <span><strong>{option}</strong><small>Room override</small></span>{participant.reasoning_effort_override===option&&<Check/>}
      </button>)}
      {!options.length&&<small className={styles.empty}>This model uses automatic reasoning.</small>}
    </span>,document.body)}
  </span>;
}
