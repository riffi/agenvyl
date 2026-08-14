import {Clock3,LoaderCircle,Zap} from 'lucide-react';
import {useState} from 'react';
import type {Message} from '../../entities/message';
import type {Persona} from '../../entities/persona';
import {Button} from '../../shared/ui';
import styles from './Composer.module.css';

export const PendingFollowUps=({messages,personas,onApplyNow}:{messages:Message[];personas:Persona[];onApplyNow:(messageId:string)=>Promise<void>})=><section className={styles['pending-follow-ups']} aria-label="Queued messages">
  {messages.map(message=><PendingFollowUp key={message.id} message={message} persona={personas.find(item=>item.handle===message.delivery?.agent)} onApplyNow={onApplyNow}/>)}
</section>;

const PendingFollowUp=({message,persona,onApplyNow}:{message:Message;persona?:Persona;onApplyNow:(messageId:string)=>Promise<void>})=>{
  const[applying,setApplying]=useState(false),[error,setError]=useState<string>();
  const agent=persona?.name??(message.delivery?.agent?`@${message.delivery.agent}`:'the agent'),dispatching=message.delivery?.status==='dispatching';
  const apply=async()=>{if(applying||dispatching)return;setApplying(true);setError(undefined);try{await onApplyNow(message.id)}catch(issue){setError(issue instanceof Error?issue.message:String(issue))}finally{setApplying(false)}};
  return <article className={styles['pending-follow-up']}>
    <Clock3 aria-hidden="true"/>
    <div className={styles['pending-follow-up-copy']}>
      <span role="status"><strong>{dispatching?'Applying now':`Waiting for ${agent}`}</strong><small>{dispatching?'The message is being applied to the active response.':'It will be sent after the current response.'}</small></span>
      <p title={message.text}>{message.text}</p>
      <small className={styles['pending-follow-up-error']} role="alert">{error?`Could not apply now. The message is still queued. ${error}`:''}</small>
    </div>
    <Button className={styles['apply-pending-now']} size="sm" variant="secondary" disabled={applying||dispatching} aria-label={`Apply queued message to ${agent} now`} onClick={()=>void apply()} icon={applying||dispatching?<LoaderCircle className={styles.spinning} aria-hidden="true"/>:<Zap aria-hidden="true"/>}>{applying||dispatching?'Applying…':'Apply now'}</Button>
  </article>;
};
