import {useState} from 'react';
import type {HarnessSettingsState,SetupHarnessCandidate} from '@agenvyl/contracts';
import {ArrowLeft,Plus,RefreshCw} from 'lucide-react';
import {HarnessIcon} from '../../entities/harness';
import {Alert,Button,Drawer,Select} from '../../shared/ui';
import {HarnessInstanceFields} from './HarnessInstanceFields';
import {addHarnessDraft,validDraft,type HarnessDraft} from './harnessSettingsModel';
import styles from './HarnessSettingsPage.module.css';

type DiscoverySection='detected'|'setup'|'missing';
const sectionOf=(candidate:SetupHarnessCandidate):DiscoverySection=>candidate.safeToSelect?'detected':candidate.cli.found||candidate.endpoint?.reachable?'setup':'missing';
const sectionLabel:Record<DiscoverySection,string>={detected:'Detected',setup:'Needs setup',missing:'Not found'};
const message=(value:unknown)=>value instanceof Error?value.message:String(value);

export const AddHarnessDrawer=({open,state,onClose,onRescan,onAdd}:{open:boolean;state?:HarnessSettingsState;onClose:()=>void;onRescan:()=>Promise<void>;onAdd:(draft:HarnessDraft)=>Promise<void>})=>{
  const[draft,setDraft]=useState<HarnessDraft>(),[custom,setCustom]=useState(false),[busy,setBusy]=useState(false),[rescanning,setRescanning]=useState(false),[error,setError]=useState('');
  const close=()=>{if(draft&&!confirm('Discard this new harness draft?'))return;setDraft(undefined);setCustom(false);setError('');onClose();};
  const start=(candidate:SetupHarnessCandidate)=>{if(candidate.requiresConfirmation==='cursor_experimental'&&prompt('Cursor CLI is experimental. Cursor rules, MCP servers, and hooks remain active, and Work has no approval bridge. Type CURSOR to continue.')!=='CURSOR')return;setCustom(false);setError('');setDraft(addHarnessDraft(candidate.type,state?.instances??[],state?.candidates??[]));};
  const startCustom=(type:'hermes'|'opencode'='hermes')=>{setCustom(true);setError('');setDraft(addHarnessDraft(type,state?.instances??[],state?.candidates??[]));};
  const rescan=async()=>{setRescanning(true);setError('');try{await onRescan();}catch(issue){setError(message(issue));}finally{setRescanning(false);}};
  const add=async()=>{if(!draft||!validDraft([draft]))return;setBusy(true);setError('');try{await onAdd(draft);setDraft(undefined);setCustom(false);onClose();}catch(issue){setError(message(issue));}finally{setBusy(false);}};
  const candidates=state?.candidates??[];
  return <Drawer open={open} title="Add harness" onClose={close} wide modal>
    <div className={styles.addDrawer}>
      <div className={styles.drawerToolbar}>
        {draft?<Button type="button" variant="ghost" icon={<ArrowLeft/>} onClick={()=>{setDraft(undefined);setCustom(false);setError('');}}>Runtime catalog</Button>:<span>Connector environment</span>}
        <Button type="button" variant="ghost" disabled={rescanning||busy} icon={<RefreshCw className={rescanning?styles.spinning:''}/>} onClick={()=>void rescan()}>{rescanning?'Scanning…':'Rescan'}</Button>
      </div>
      {error&&<Alert>{error}</Alert>}
      {draft?<>
        <section className={styles.creationHeader}><HarnessIcon type={draft.type} size="md"/><span><strong>{custom?'Custom endpoint':candidates.find(candidate=>candidate.type===draft.type)?.label??draft.type}</strong><small>Test this configuration before adding it.</small></span></section>
        {custom&&<label className={styles.customType}><span>Runtime type</span><Select value={draft.type} onChange={event=>startCustom(event.target.value as 'hermes'|'opencode')}><option value="hermes">Hermes</option><option value="opencode">OpenCode</option></Select></label>}
        <HarnessInstanceFields instance={draft} newInstance onChange={setDraft}/>
        <div className={styles.addActions}><Button type="button" variant="primary" disabled={busy||!validDraft([draft])} icon={<Plus/>} onClick={()=>void add()}>{busy?'Testing…':'Add & test'}</Button></div>
      </>:<>
        {(['detected','setup','missing'] as const).map(section=>{
          const items=candidates.filter(candidate=>sectionOf(candidate)===section);if(!items.length)return null;
          return <section className={styles.discoveryGroup} key={section}><h3>{sectionLabel[section]}</h3>{items.map(candidate=>{
            const configured=state?.instances.filter(instance=>instance.type===candidate.type).length??0;
            return <article className={styles.addOption} key={candidate.type}>
              <HarnessIcon type={candidate.type} size="md"/><span><strong>{candidate.label}</strong><small>{candidate.cli.version??candidate.cli.command}{configured?` · ${configured} configured`:''}</small></span>
              {section==='detected'?<Button type="button" variant="primary" onClick={()=>start(candidate)}>{configured?'Add another':'Configure'}</Button>:<details><summary>Setup guide</summary><p>{candidate.warning??(candidate.cli.found?'Complete authentication or runtime setup, then rescan.':`Install ${candidate.cli.command}, then rescan.`)}</p>{candidate.auth&&<small>{candidate.auth.authenticated?'Authenticated':`Authentication required · ${candidate.auth.kind}`}</small>}</details>}
            </article>;
          })}</section>;
        })}
        <Button type="button" className={styles.customEndpoint} icon={<Plus/>} onClick={()=>startCustom()}>Configure custom endpoint</Button>
      </>}
    </div>
  </Drawer>;
};
