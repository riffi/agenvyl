import type {SetupHarnessInstance} from '@agenvyl/contracts';
import {RefreshCw,Trash2} from 'lucide-react';
import {HarnessIcon} from '../../entities/harness';
import {Alert,Button,Input,Select} from '../../shared/ui';
import type {HarnessDraft} from './harnessSettingsModel';
import styles from './HarnessSettingsPage.module.css';

const statusLabel:Record<HarnessDraft['status'],string>={healthy:'Healthy',degraded:'Degraded',unavailable:'Unavailable',disabled:'Disabled'};

export const HarnessInstanceCard=({instance,isNew,checking,checkMessage,onChange,onRemove,onCheck}:{instance:HarnessDraft;isNew:boolean;checking:boolean;checkMessage?:string;onChange:(next:HarnessDraft)=>void;onRemove:()=>void;onCheck:()=>void})=>{
  const update=<K extends keyof SetupHarnessInstance>(key:K,value:SetupHarnessInstance[K])=>onChange({...instance,[key]:value});
  const used=instance.personas.length>0;
  return <article className={`${styles.instance} ${styles[instance.status]}`}>
    <header className={styles.instanceHeader}>
      <div className={styles.identity}><HarnessIcon type={instance.type} size="md"/><span><strong>{instance.id}</strong><small>{instance.type}</small></span></div>
      <span className={styles.status}><i/>{instance.enabled?statusLabel[instance.status]:'Disabled'}</span>
    </header>
    <div className={styles.formGrid}>
      <label><span>Instance ID</span><Input value={instance.id} readOnly={!isNew} onChange={event=>update('id',event.target.value.toLowerCase())}/><small>{isNew?'Lowercase letters, numbers, - and _':'Identity is immutable after saving'}</small></label>
      <label className={styles.switchField}><span>Availability</span><button type="button" role="switch" aria-checked={instance.enabled} className={instance.enabled?styles.switchOn:''} onClick={()=>onChange({...instance,enabled:!instance.enabled,status:instance.enabled?'disabled':instance.status==='disabled'?'unavailable':instance.status})}><i/><b>{instance.enabled?'Enabled':'Disabled'}</b></button><small>{used&&!instance.enabled?`${instance.personas.length} agent${instance.personas.length===1?'':'s'} will become unavailable`:'Can be changed without deleting the configuration'}</small></label>
      {instance.type!=='antigravity'&&instance.type!=='codex'&&<label className={styles.full}><span>Endpoint</span><Input type="url" placeholder={instance.type==='hermes'?'http://127.0.0.1:8642':'http://127.0.0.1:4096'} value={instance.endpoint??''} onChange={event=>update('endpoint',event.target.value)}/></label>}
      {instance.type==='opencode'&&<label className={`${styles.checkField} ${styles.full}`}><input type="checkbox" checked={Boolean(instance.managed)} onChange={event=>update('managed',event.target.checked)}/><span><strong>Managed server</strong><small>Agenvyl starts and stops this OpenCode process.</small></span></label>}
      {instance.type==='antigravity'&&<label className={styles.full}><span>Permission mode</span><Select value={instance.permissionMode??'plan'} onChange={event=>update('permissionMode',event.target.value as 'plan'|'accept-edits')}><option value="plan">Plan — read-only</option><option value="accept-edits">Accept edits — may modify files</option></Select></label>}
      {instance.type==='codex'&&<label className={`${styles.checkField} ${styles.full}`}><input type="checkbox" checked={Boolean(instance.allowDangerFullAccess)} onChange={event=>{if(event.target.checked&&prompt('This permits Codex to run without sandboxing or approvals. Type CODEX FULL ACCESS to continue.')!=='CODEX FULL ACCESS'){event.target.checked=false;return;}update('allowDangerFullAccess',event.target.checked);}}/><span><strong>Allow danger-full-access</strong><small>Publishes unsandboxed modes with approval policy “never”. Enabling requires an exact confirmation phrase.</small></span></label>}
    </div>
    {used&&<Alert tone="warning" className={styles.usage}><span><strong>Used by {instance.personas.length} agent{instance.personas.length===1?'':'s'}</strong><small>{instance.personas.map(persona=>`@${persona.handle}${persona.archived?' (archived)':''}`).join(', ')}</small></span></Alert>}
    {instance.error&&<p className={styles.runtimeError}>{instance.error.message}</p>}
    {checkMessage&&<p className={styles.checkMessage}>{checkMessage}</p>}
    <footer><Button type="button" disabled={checking||isNew||!instance.enabled} icon={<RefreshCw className={checking?styles.spinning:''}/>} onClick={onCheck}>{checking?'Checking…':'Test connection'}</Button><Button type="button" variant="danger" disabled={used} title={used?'Reassign or remove the listed agents before deleting this harness':'Remove harness'} icon={<Trash2/>} onClick={onRemove}>Remove</Button></footer>
  </article>;
};
