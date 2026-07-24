import {useEffect,useMemo,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,Cable,Plus,RefreshCw,Save} from 'lucide-react';
import {Link} from 'react-router-dom';
import type {HarnessSettingsState,SetupHarnessCandidate,SetupHarnessInstance} from '@agenvyl/contracts';
import {harnessKeys,harnessesApi,type HarnessCatalog} from '../../entities/harness';
import {Alert,Button,EmptyState,Select,Spinner} from '../../shared/ui';
import {HarnessCandidateCard} from './HarnessCandidateCard';
import {HarnessInstanceCard} from './HarnessInstanceCard';
import {addHarnessDraft,configurationOf,sameConfiguration,validDraft,type HarnessDraft} from './harnessSettingsModel';
import styles from './HarnessSettingsPage.module.css';

const harnessTypes:Array<{type:SetupHarnessInstance['type'];label:string}>=[{type:'hermes',label:'Hermes'},{type:'opencode',label:'OpenCode'},{type:'codex',label:'Codex'},{type:'antigravity',label:'Antigravity'}];
const message=(value:unknown)=>value instanceof Error?value.message:String(value);

export const HarnessSettingsPage=()=>{
  const queryClient=useQueryClient();
  const[state,setState]=useState<HarnessSettingsState>();
  const[drafts,setDrafts]=useState<HarnessDraft[]>([]);
  const[addingType,setAddingType]=useState<SetupHarnessInstance['type']>('hermes');
  const[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const[connecting,setConnecting]=useState<SetupHarnessInstance['type']>();
  const[checking,setChecking]=useState<string>(),[checks,setChecks]=useState<Record<string,string>>({});
  const dirty=useMemo(()=>Boolean(state&&!sameConfiguration(drafts,state.instances)),[drafts,state]);
  const newDrafts=useMemo(()=>drafts.filter(instance=>!state?.instances.some(saved=>saved.id===instance.id)),[drafts,state]);
  const readyCount=useMemo(()=>state?.candidates.filter(candidate=>candidate.safeToSelect&&!state.instances.some(instance=>instance.type===candidate.type)).length??0,[state]);
  const valid=validDraft(drafts);

  const load=async(refresh=false,refreshCatalog=refresh)=>{
    setLoading(true);setError('');
    try{
      const settingsRequest=harnessesApi.settings(undefined,refresh);
      const catalogRequest=refreshCatalog?harnessesApi.catalog(undefined,true):undefined;
      const [settingsResult,catalogResult]=await Promise.allSettled([settingsRequest,catalogRequest??Promise.resolve(undefined)]);
      if(settingsResult.status==='rejected')throw settingsResult.reason;
      const next=settingsResult.value;
      setState(next);setDrafts(next.instances);
      if(catalogResult.status==='fulfilled'&&catalogResult.value)queryClient.setQueryData(harnessKeys.catalog,catalogResult.value);
      else if(catalogResult.status==='rejected')setError(`Harness settings were refreshed, but the model catalog failed: ${message(catalogResult.reason)}`);
      return next;
    }catch(issue){setError(message(issue));}finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[]);
  useEffect(()=>{
    if(state?.discoveryCache.state!=='refreshing'||dirty)return;
    const timer=window.setInterval(()=>void load(false,false),2_000);
    return()=>window.clearInterval(timer);
  },[state?.discoveryCache.state,dirty]);
  useEffect(()=>{const beforeUnload=(event:BeforeUnloadEvent)=>{if(!dirty)return;event.preventDefault();};addEventListener('beforeunload',beforeUnload);return()=>removeEventListener('beforeunload',beforeUnload);},[dirty]);

  const add=()=>{setNotice('');setDrafts(current=>[...current,addHarnessDraft(addingType,current,state?.candidates??[])]);};
  const update=(index:number,next:HarnessDraft)=>{setNotice('');setDrafts(current=>current.map((item,itemIndex)=>itemIndex===index?next:item));};
  const remove=(index:number)=>{setNotice('');setDrafts(current=>current.filter((_,itemIndex)=>itemIndex!==index));};
  const persist=async(next:HarnessDraft[],successMessage:string,verifyIds:string[]=[])=>{
    setSaving(true);setError('');setNotice('');
    try{
      await harnessesApi.configure({instances:next.map(configurationOf)});
      let verificationError='';
      let catalog:HarnessCatalog|undefined;
      try{
        catalog=await harnessesApi.catalog(undefined,true);
        queryClient.setQueryData(harnessKeys.catalog,catalog);
      }catch(issue){verificationError=message(issue);}
      if(verifyIds.length&&catalog)try{
        const failed=verifyIds.map(id=>catalog.instances.find(instance=>instance.id===id)).find(instance=>!instance||instance.status==='unavailable');
        if(failed)verificationError=failed?.error?.message??'The saved harness did not become available.';
      }catch(issue){verificationError=message(issue);}
      const refreshed=await load(true,false);
      if(refreshed&&verificationError)setError(`Configuration was saved, but the connection check failed: ${verificationError}`);
      else if(refreshed)setNotice(successMessage);
    }
    catch(issue){setError(message(issue));}finally{setSaving(false);}
  };
  const save=async()=>{
    if(!valid)return;
    const affected=drafts.filter(instance=>!instance.enabled&&instance.personas.length);
    if(affected.length&&!confirm(`Disable ${affected.map(instance=>instance.id).join(', ')}? ${affected.reduce((sum,instance)=>sum+instance.personas.length,0)} agent routes will become unavailable.`))return;
    await persist(drafts,newDrafts.length?'Harness connected and configuration saved.':'Harness configuration saved.',newDrafts.map(instance=>instance.id));
  };
  const connect=async(candidate:SetupHarnessCandidate)=>{
    if(dirty||!candidate.safeToSelect)return;
    if(candidate.requiresConfirmation==='claude_oauth'&&prompt('Claude subscription OAuth is experimental and may conflict with Anthropic terms for third-party products. Type CLAUDE OAUTH to continue.')!=='CLAUDE OAUTH')return;
    const draft={...addHarnessDraft(candidate.type,drafts,state?.candidates??[]),...(candidate.requiresConfirmation==='claude_oauth'?{allowSubscriptionOAuth:true}:{})},next=[...drafts,draft];
    setConnecting(candidate.type);
    try{await persist(next,`${candidate.label} connected.`,[draft.id]);}finally{setConnecting(undefined);}
  };
  const check=async(instance:HarnessDraft)=>{
    if(dirty){setChecks(current=>({...current,[instance.id]:'Save pending changes before testing this connection.'}));return;}
    setChecking(instance.id);setChecks(current=>({...current,[instance.id]:''}));
    const next=await load(true);
    const result=next?.instances.find(item=>item.id===instance.id);
    setChecks(current=>({...current,[instance.id]:result?.status==='healthy'?'Connection is healthy.':result?.error?.message??`Connection status: ${result?.status??'unavailable'}.`}));
    setChecking(undefined);
  };

  return <main className={styles.shell}>
    <aside className={styles.rail}><Link to="/" className={styles.back} onClick={event=>{if(dirty&&!confirm('Discard unsaved harness configuration changes?'))event.preventDefault();}}><ArrowLeft/>Workspace</Link><div><p>Settings</p><span className={styles.active}><Cable/>Harnesses</span></div><small>Local connector<br/>configuration</small></aside>
    <section className={styles.content}>
      <header className={styles.pageHeader}><span><strong><Cable/>Harnesses</strong><small>{state?`${state.instances.length} connected${readyCount?` · ${readyCount} ready to connect`:''}`:'Local connector configuration'}</small></span><Button type="button" disabled={loading||dirty} title={dirty?'Save or discard changes before rescanning':'Discover harnesses and refresh status'} icon={<RefreshCw className={loading?styles.spinning:''}/>} onClick={()=>void load(true)}>Rescan</Button></header>
      <div className={styles.pageBody}>
        <p className={styles.description}>Agenvyl checks this machine for supported agent runtimes. Connect a ready harness or follow the setup guidance when one needs attention.</p>
        {error&&<Alert>{error}</Alert>}{state&&state.discoveryCache.state!=='fresh'&&<Alert tone="warning">Harness discovery is {state.discoveryCache.state}. Showing the last known candidates{cacheTime(state.discoveryCache.refreshedAt)}.</Alert>}{notice&&<p className={styles.notice} role="status">{notice}</p>}
        {loading&&!state?<div className={styles.loading}><Spinner label="Discovering local harnesses…"/></div>:<>
          <section className={styles.discoverySection} aria-labelledby="available-harnesses"><div className={styles.sectionHeading}><span><strong id="available-harnesses">Available harnesses</strong><small>Detected automatically from the Connector environment.</small></span>{readyCount>0&&<b>{readyCount} ready</b>}</div><div className={styles.candidates}>{state?.candidates.map(candidate=><HarnessCandidateCard key={candidate.type} candidate={candidate} instances={state.instances} connecting={connecting===candidate.type} connectDisabled={dirty||saving} onConnect={()=>void connect(candidate)} onRescan={()=>void load(true)}/>)}</div></section>
          <section className={styles.connectedSection} aria-labelledby="connected-harnesses"><div className={styles.sectionHeading}><span><strong id="connected-harnesses">Connected instances</strong><small>Routes and runtime-specific controls used by your agents.</small></span><b>{drafts.length}</b></div><div className={styles.instances}>{drafts.map((instance,index)=><HarnessInstanceCard key={`${instance.id}-${index}`} instance={instance} isNew={!state?.instances.some(saved=>saved.id===instance.id)} checking={checking===instance.id} checkMessage={checks[instance.id]} onChange={next=>update(index,next)} onRemove={()=>remove(index)} onCheck={()=>void check(instance)}/>)}</div></section>
          {!drafts.length&&<EmptyState compact className={styles.empty} icon={<Cable/>} title="No connected harnesses" description="Connect a detected harness above, or add one manually if it uses a custom configuration."/>}
          <details className={styles.advanced}><summary><span><Plus/><strong>Add manually</strong></span><small>Custom endpoints and additional instances</small></summary><div className={styles.addBar}><span><strong>New harness instance</strong><small>Use this for additional instances or custom endpoints.</small></span><Select aria-label="Harness type" value={addingType} onChange={event=>setAddingType(event.target.value as SetupHarnessInstance['type'])}>{harnessTypes.map(item=><option key={item.type} value={item.type}>{item.label}</option>)}</Select><Button type="button" icon={<Plus/>} onClick={add}>Add instance</Button></div></details>
        </>}
      </div>
      <footer className={styles.saveBar}><span>{dirty?newDrafts.length?`${newDrafts.length} new instance${newDrafts.length===1?'':'s'} not saved`:'Unsaved configuration changes':state?`${state.instances.length} connected instance${state.instances.length===1?'':'s'}`:'Configuration unavailable'}</span><Button type="button" variant="primary" icon={<Save/>} disabled={!dirty||!valid||saving} onClick={()=>void save()}>{saving?'Saving…':newDrafts.length?'Save & connect':'Save changes'}</Button></footer>
    </section>
  </main>;
};

const cacheTime=(value:string|null)=>value?` from ${new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`:'';
