import {Fragment} from 'react';
import styles from './Composer.module.css';

export const AUTO_ROUTING_GUIDANCE_ID='auto-routing-guidance';

export const AutoRoutingGuidance=({candidates,visible,onMention}:{candidates:string[];visible:boolean;onMention:(handle:string)=>void})=><div id={AUTO_ROUTING_GUIDANCE_ID} className={styles['routing-guidance']} role="status" aria-live="polite">
  {visible&&<span><strong>Auto needs a recipient.</strong> Available agents: {candidates.map((handle,index)=><Fragment key={handle}>{index?', ':''}<button type="button" className={styles['routing-mention']} aria-label={`Add @${handle} to message`} onClick={()=>onMention(handle)}>@{handle}</button></Fragment>)}. Mention one agent or use <button type="button" className={styles['routing-mention']} aria-label="Add @all to message" onClick={()=>onMention('all')}>@all</button>.</span>}
</div>;
