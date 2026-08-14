import type {HarnessSettingsInstance} from '@agenvyl/contracts';
import {ArrowLeft,Info,RefreshCw,RotateCcw,Save,Trash2} from 'lucide-react';
import {HarnessIcon} from '../../entities/harness';
import {Alert,Button} from '../../shared/ui';
import {HarnessInstanceFields} from './HarnessInstanceFields';
import {healthStatus,sameInstanceConfiguration,validDraft,type HarnessDraft} from './harnessSettingsModel';
import styles from './HarnessSettingsPage.module.css';

const healthLabel={healthy:'Healthy',degraded:'Degraded',unavailable:'Unavailable'} as const;

export const HarnessInstanceEditor=({saved,draft,saving,testing,restarting,testMessage,onChange,onSave,onCancel,onTest,onRestart,onRemove,onBack}:{saved:HarnessSettingsInstance;draft:HarnessDraft;saving:boolean;testing:boolean;restarting:boolean;testMessage?:{text:string;failed?:boolean};onChange:(next:HarnessDraft)=>void;onSave:()=>void;onCancel:()=>void;onTest:()=>void;onRestart:()=>void;onRemove:()=>void;onBack:()=>void})=>{
  const health=healthStatus(saved),dirty=!sameInstanceConfiguration(draft,saved),used=saved.personas.length>0,valid=validDraft([draft]);
  return <article className={styles.editor}>
    <header className={styles.editorHeader}>
      <Button type="button" variant="ghost" className={styles.mobileBack} aria-label="Back to harness list" icon={<ArrowLeft/>} onClick={onBack}/>
      <HarnessIcon type={saved.type} size="md"/><span><strong>{saved.id}</strong><small>{saved.type}</small></span>
      <span className={`${styles.health} ${health?styles[`health_${health}`]:styles.health_idle}`}><i/>{health?healthLabel[health]:'Not checked'}</span>
    </header>
    <div className={styles.editorScroll}>
      <HarnessInstanceFields instance={draft} newInstance={false} onChange={onChange}/>
      {saved.type==='antigravity'&&<section className={styles.retentionNotice} aria-label="Session history"><Info aria-hidden="true"/><span><strong>Session history is managed by AGY</strong><small>AGY stores native conversations and controls their retention. Agenvyl can resume them by conversation ID, but cannot delete their history from AGY.</small></span></section>}
      {used&&<Alert tone="warning" className={styles.usage}><span><strong>Used by {saved.personas.length} agent{saved.personas.length===1?'':'s'}</strong><small>{saved.personas.map(persona=>`@${persona.handle}${persona.archived?' (archived)':''}`).join(', ')}</small></span></Alert>}
      {saved.error&&<Alert>{saved.error.message}</Alert>}
      {saved.type==='opencode'&&<Alert tone={saved.managed?'warning':undefined}>{saved.managed
        ?saved.activeExecutions?`Restart is disabled while ${saved.activeExecutions} execution${saved.activeExecutions===1?' is':'s are'} active.`:'Agenvyl owns this OpenCode server and can restart it to reload configuration and models.'
        :'This OpenCode server is externally managed. Restart it outside Agenvyl.'}</Alert>}
      {testMessage&&<p className={`${styles.testMessage} ${testMessage.failed?styles.testFailed:''}`} role="status">{testMessage.text}</p>}
    </div>
    <footer className={styles.editorActions}>
      <Button type="button" disabled={testing||saving||!valid} icon={<RefreshCw className={testing?styles.spinning:''}/>} onClick={onTest}>{testing?'Testing…':'Test connection'}</Button>
      {saved.type==='opencode'&&saved.managed&&<Button type="button" disabled={saving||testing||restarting||dirty||Boolean(saved.activeExecutions)} title={saved.activeExecutions?'Wait for active executions to finish':dirty?'Save or cancel configuration changes before restarting':'Restart the Agenvyl-managed OpenCode server'} icon={<RotateCcw className={restarting?styles.spinning:''}/>} onClick={onRestart}>{restarting?'Restarting…':'Restart OpenCode'}</Button>}
      <Button type="button" variant="danger" disabled={used||saving} title={used?'Reassign the listed agents before deleting this harness':'Remove harness'} icon={<Trash2/>} onClick={onRemove}>Remove</Button>
      <span/>
      <Button type="button" disabled={!dirty||saving} onClick={onCancel}>Cancel</Button>
      <Button type="button" variant="primary" disabled={!dirty||!valid||saving} icon={<Save/>} onClick={onSave}>{saving?'Saving…':'Save'}</Button>
    </footer>
  </article>;
};
