import {memo,useState} from 'react';
import {Brain,ChevronDown} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Timeline.module.css';

export const ReasoningBlock=memo(({text,harnessType,isStreaming=false}:{text:string;harnessType?:string;isStreaming?:boolean})=>{
  const [open,setOpen]=useState(false);
  const markdown=harnessType==='codex'?text.replaceAll('****','**\n\n**'):text;
  return <details className={styles.reasoning} data-streaming={isStreaming?'true':undefined} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary onClick={event=>setOpen(!(event.currentTarget.parentElement as HTMLDetailsElement).open)}><Brain className={styles['reasoning-icon']}/><span>Reasoning</span><ChevronDown className={styles['reasoning-chevron']}/></summary>
    {open&&<div className={styles.reasoningBody}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a:({node:_node,...props})=><a {...props} target="_blank" rel="noopener noreferrer"/>,
          img:({node:_node,alt})=><span className={styles.reasoningImage}>[Image omitted{alt?.trim()?`: ${alt.trim()}`:''}]</span>,
        }}
      >{markdown}</Markdown>
    </div>}
  </details>;
});

ReasoningBlock.displayName='ReasoningBlock';
