import { useState } from 'react';
import { LoaderCircle, Play, X } from 'lucide-react';
import { Button, TextArea } from '../../shared/ui';
import styles from './Composer.module.css';

export type ImplementationTarget={handle:string;name:string;detail:string;color:string};
export type ImplementationDraft={text:string;targets:string[];messageId:string};

export const ImplementationHandoff=({targets,initialTargets,onStart,onClose}:{targets:ImplementationTarget[];initialTargets:string[];onStart:(draft:ImplementationDraft)=>Promise<void>;onClose:()=>void})=>{
  const defaults=initialTargets.length?initialTargets:targets.length===1?[targets[0].handle]:[];
  const [selected,setSelected]=useState(()=>new Set(defaults));
  const [instructions,setInstructions]=useState('Implement the approved plan.');
  const [messageId]=useState(()=>crypto.randomUUID());
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string>();
  const selectedCount=selected.size;
  const toggle=(handle:string)=>setSelected(current=>{const next=new Set(current);next.has(handle)?next.delete(handle):next.add(handle);return next;});
  const start=async()=>{if(!selectedCount||!instructions.trim()||busy)return;setBusy(true);setError(undefined);try{await onStart({text:instructions.trim(),targets:targets.filter(target=>selected.has(target.handle)).map(target=>target.handle),messageId});onClose();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};

  return <section className={styles['implementation-handoff']} aria-labelledby="implementation-handoff-title">
    <header><span><strong id="implementation-handoff-title">Who should implement?</strong><small>Select one or more agents. The room switches to Work when they start.</small></span><button type="button" aria-label="Close implementation setup" disabled={busy} onClick={onClose}><X/></button></header>
    <div className={styles['implementation-targets']}>
      {targets.map(target=><label key={target.handle} className={selected.has(target.handle)?styles.selected:''}><input type="checkbox" checked={selected.has(target.handle)} onChange={()=>toggle(target.handle)}/><i style={{background:target.color}}>{target.name[0]}</i><span><strong>{target.name}</strong><small>@{target.handle} · {target.detail}</small></span></label>)}
    </div>
    <label className={styles['implementation-instructions']}><span>Instructions</span><TextArea value={instructions} maxLength={4000} onChange={event=>setInstructions(event.target.value)}/></label>
    {error&&<div className={styles['implementation-error']} role="alert">Could not start implementation: {error}</div>}
    <footer><Button type="button" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button type="button" size="sm" variant="primary" disabled={!selectedCount||!instructions.trim()||busy} onClick={()=>void start()} icon={busy?<LoaderCircle className={styles.spinning}/>:<Play/>}>{busy?'Starting…':`Start with ${selectedCount} ${selectedCount===1?'agent':'agents'}`}</Button></footer>
  </section>;
};
