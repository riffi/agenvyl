import {useEffect,useRef,useState} from 'react';
import {Check,Copy,TriangleAlert} from 'lucide-react';
import {IconButton} from '../../shared/ui';
import styles from './Timeline.module.css';

type CopyState='idle'|'copied'|'failed';

type Props={
  text:string;
  label:string;
  copiedLabel:string;
  className?:string;
};

export const CopyTextButton=({text,label,copiedLabel,className=''}:Props)=>{
  const [state,setState]=useState<CopyState>('idle');
  const resetRef=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>{
    setState('idle');
    return()=>clearTimeout(resetRef.current);
  },[text]);
  const copy=async()=>{
    clearTimeout(resetRef.current);
    try{
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      setState('copied');
    }catch{
      setState('failed');
    }
    resetRef.current=setTimeout(()=>setState('idle'),1_800);
  };
  const actionLabel=state==='copied'?copiedLabel:state==='failed'?`${label} failed, try again`:label;
  const feedback=state==='copied'?copiedLabel:state==='failed'?'Copy failed, try again':'';
  return <IconButton type="button" className={`${styles['copy-action']} ${className}`} data-state={state} disabled={!text} onClick={()=>void copy()} aria-label={actionLabel} title={actionLabel}>
    {state==='copied'?<Check aria-hidden="true"/>:state==='failed'?<TriangleAlert aria-hidden="true"/>:<Copy aria-hidden="true"/>}
    <span className={styles['copy-feedback']} aria-live="polite" aria-atomic="true">{feedback}</span>
  </IconButton>;
};
