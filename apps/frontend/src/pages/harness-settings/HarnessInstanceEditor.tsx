import type {HarnessSettingsInstance} from '@agenvyl/contracts';
import {ArrowLeft,RefreshCw,Save,Trash2} from 'lucide-react';
import {HarnessIcon} from '../../entities/harness';
import {Alert,Button} from '../../shared/ui';
import {HarnessInstanceFields} from './HarnessInstanceFields';
import {healthStatus,sameInstanceConfiguration,validDraft,type HarnessDraft} from './harnessSettingsModel';
import styles from './HarnessSettingsPage.module.css';

const healthLabel={healthy:'Healthy',degraded:'Degraded',unavailable:'Unavailable'} as const;

export const HarnessInstanceEditor=({saved,draft,saving,testing,testMessage,onChange,onSave,onCancel,onTest,onRemove,onBack}:{saved:HarnessSettingsInstance;draft:HarnessDraft;saving:boolean;testing:boolean;testMessage?:{text:string;failed?:boolean};onChange:(next:HarnessDraft)=>void;onSave:()=>void;onCancel:()=>void;onTest:()=>void;onRemove:()=>void;onBack:()=>void})=>{
  const health=healthStatus(saved),dirty=!sameInstanceConfiguration(draft,saved),used=saved.personas.length>0,valid=validDraft([draft]);
  return <article className={styles.editor}>
    <header className={styles.editorHeader}>
      <Button type="button" variant="ghost" className={styles.mobileBack} aria-label="Back to harness list" icon={<ArrowLeft/>} onClick={onBack}/>
      <HarnessIcon type={saved.type} size="md"/><span><strong>{saved.id}</strong><small>{saved.type}</small></span>
      <span className={`${styles.health} ${health?styles[`health_${health}`]:styles.health_idle}`}><i/>{health?healthLabel[health]:'Not checked'}</span>
    </header>
    <div className={styles.editorScroll}>
      <HarnessInstanceFields instance={draft} newInstance={false} onChange={onChange}/>
      {used&&<Alert tone="warning" className={styles.usage}><span><strong>Used by {saved.personas.length} agent{saved.personas.length===1?'':'s'}</strong><small>{saved.personas.map(persona=>`@${persona.handle}${persona.archived?' (archived)':''}`).join(', ')}</small></span></Alert>}
      {saved.error&&<Alert>{saved.error.message}</Alert>}
      {testMessage&&<p className={`${styles.testMessage} ${testMessage.failed?styles.testFailed:''}`} role="status">{testMessage.text}</p>}
    </div>
    <footer className={styles.editorActions}>
      <Button type="button" disabled={testing||saving||!valid} icon={<RefreshCw className={testing?styles.spinning:''}/>} onClick={onTest}>{testing?'Testing…':'Test connection'}</Button>
      <Button type="button" variant="danger" disabled={used||saving} title={used?'Reassign the listed agents before deleting this harness':'Remove harness'} icon={<Trash2/>} onClick={onRemove}>Remove</Button>
      <span/>
      <Button type="button" disabled={!dirty||saving} onClick={onCancel}>Cancel</Button>
      <Button type="button" variant="primary" disabled={!dirty||!valid||saving} icon={<Save/>} onClick={onSave}>{saving?'Saving…':'Save'}</Button>
    </footer>
  </article>;
};
