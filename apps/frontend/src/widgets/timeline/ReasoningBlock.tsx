import {Brain,ChevronDown} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Timeline.module.css';

export const ReasoningBlock=({text,harnessType}:{text:string;harnessType?:string})=>{
  const markdown=harnessType==='codex'?text.replaceAll('****','**\n\n**'):text;
  return <details className={styles.reasoning}>
    <summary><Brain className={styles['reasoning-icon']}/><span>Reasoning</span><ChevronDown className={styles['reasoning-chevron']}/></summary>
    <div className={styles.reasoningBody}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a:({node:_node,...props})=><a {...props} target="_blank" rel="noopener noreferrer"/>,
          img:({node:_node,alt})=><span className={styles.reasoningImage}>[Image omitted{alt?.trim()?`: ${alt.trim()}`:''}]</span>,
        }}
      >{markdown}</Markdown>
    </div>
  </details>;
};
