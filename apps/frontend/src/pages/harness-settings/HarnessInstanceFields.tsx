import type {SetupHarnessInstance} from '@agenvyl/contracts';
import {Input,Select,TextArea} from '../../shared/ui';
import type {HarnessDraft} from './harnessSettingsModel';
import styles from './HarnessSettingsPage.module.css';

export const HarnessInstanceFields=({instance,newInstance,onChange}:{instance:HarnessDraft;newInstance:boolean;onChange:(next:HarnessDraft)=>void})=>{
  const update=<K extends keyof SetupHarnessInstance>(key:K,value:SetupHarnessInstance[K])=>onChange({...instance,[key]:value});
  return <div className={styles.formGrid}>
    <label><span>Instance ID</span><Input value={instance.id} readOnly={!newInstance} onChange={event=>update('id',event.target.value.toLowerCase())}/><small>{newInstance?'Lowercase letters, numbers, - and _':'Identity is immutable after saving'}</small></label>
    <label className={styles.switchField}><span>Configuration</span><button type="button" role="switch" aria-checked={instance.enabled} className={instance.enabled?styles.switchOn:''} onClick={()=>update('enabled',!instance.enabled)}><i/><b>{instance.enabled?'Enabled':'Disabled'}</b></button><small>Disabled instances remain configured but are not started automatically.</small></label>
    {!['antigravity','codex','claude'].includes(instance.type)&&<label className={styles.full}><span>Endpoint</span><Input type="url" placeholder={instance.type==='hermes'?'http://127.0.0.1:8642':'http://127.0.0.1:4096'} value={instance.endpoint??''} onChange={event=>update('endpoint',event.target.value)}/></label>}
    {instance.type==='opencode'&&<label className={`${styles.checkField} ${styles.full}`}><input type="checkbox" checked={Boolean(instance.managed)} onChange={event=>update('managed',event.target.checked)}/><span><strong>Managed server</strong><small>Start and stop the local OpenCode service when Agenvyl needs it.</small></span></label>}
    {instance.type==='opencode'&&<label className={styles.full}><span>Allowed external directories</span><TextArea aria-label="Allowed external directories" placeholder={'One absolute path per line\nC:\\work\\trusted-repo\n/home/user/trusted-repo'} value={(instance.externalDirectoryRoots??[]).join('\n')} onChange={event=>update('externalDirectoryRoots',event.target.value.split(/\r?\n/).map(root=>root.trim()).filter(Boolean))}/><small>Empty means external access is denied.</small></label>}
    {instance.type==='antigravity'&&<label className={styles.full}><span>Permission mode</span><Select value={instance.permissionMode??'plan'} onChange={event=>update('permissionMode',event.target.value as 'plan'|'accept-edits')}><option value="plan">Plan — read-only workflow</option><option value="accept-edits">Accept edits — may modify files</option></Select></label>}
    {instance.type==='claude'&&<details className={`${styles.editorAdvanced} ${styles.full}`}><summary>Advanced security options</summary>
      <label className={styles.checkField}><input type="checkbox" checked={Boolean(instance.allowSubscriptionOAuth)} onChange={event=>{if(event.target.checked&&prompt('Claude subscription OAuth is experimental and may conflict with Anthropic terms for third-party products. Type CLAUDE OAUTH to continue.')!=='CLAUDE OAUTH'){event.target.checked=false;return;}update('allowSubscriptionOAuth',event.target.checked);}}/><span><strong>Allow subscription OAuth</strong><small>Experimental opt-in; API or supported cloud authentication is preferred.</small></span></label>
    </details>}
  </div>;
};
