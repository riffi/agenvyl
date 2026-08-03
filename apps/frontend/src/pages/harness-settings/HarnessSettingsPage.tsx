import {useEffect,useMemo,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,Cable,Plus,RefreshCw} from 'lucide-react';
import {Link,useBlocker,useNavigate,useParams} from 'react-router-dom';
import type {HarnessSettingsInstance,HarnessSettingsState} from '@agenvyl/contracts';
import {harnessKeys,harnessesApi} from '../../entities/harness';
import {Alert,Button,Dialog,EmptyState,Spinner} from '../../shared/ui';
import {AddHarnessDrawer} from './AddHarnessDrawer';
import {HarnessInstanceEditor} from './HarnessInstanceEditor';
import {HarnessInstanceRow} from './HarnessInstanceRow';
import {configurationOf,groupHarnessInstances,harnessSettingsSummary,sameInstanceConfiguration,validDraft,type HarnessDraft} from './harnessSettingsModel';
import styles from './HarnessSettingsPage.module.css';

const message=(value:unknown)=>value instanceof Error?value.message:String(value);
const asDraft=(instance:HarnessSettingsInstance):HarnessDraft=>({...instance});

export const HarnessSettingsPage=()=>{
  const{instanceId}=useParams(),navigate=useNavigate(),queryClient=useQueryClient(),allowNavigation=useRef(false);
  const[state,setState]=useState<HarnessSettingsState>(),[draft,setDraft]=useState<HarnessDraft>(),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[testing,setTesting]=useState(false),[refreshing,setRefreshing]=useState(false),[addOpen,setAddOpen]=useState(false);
  const[error,setError]=useState(''),[notice,setNotice]=useState(''),[testMessage,setTestMessage]=useState<{text:string;failed?:boolean}>(),[pendingAction,setPendingAction]=useState<(()=>void)>();
  const selected=state?.instances.find(instance=>instance.id===instanceId),dirty=Boolean(selected&&draft&&!sameInstanceConfiguration(draft,selected));
  const blocker=useBlocker(()=>dirty&&!allowNavigation.current),summary=useMemo(()=>harnessSettingsSummary(state?.instances??[]),[state]),groups=useMemo(()=>groupHarnessInstances(state?.instances??[]),[state]);

  const read=async(refreshDiscovery=false)=>{const next=await harnessesApi.settings(undefined,refreshDiscovery);setState(next);return next;};
  useEffect(()=>{void read().catch(issue=>setError(message(issue))).finally(()=>setLoading(false));},[]);
  useEffect(()=>{if(!addOpen||state?.discoveryCache.state!=='refreshing')return;const timer=window.setInterval(()=>void read(false).catch(issue=>setError(message(issue))),2_000);return()=>clearInterval(timer);},[addOpen,state?.discoveryCache.state]);
  useEffect(()=>{setTestMessage(undefined);setDraft(current=>{if(!selected)return undefined;if(current?.id!==selected.id)return asDraft(selected);return sameInstanceConfiguration(current,selected)?asDraft(selected):current;});},[selected]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};addEventListener('beforeunload',warn);return()=>removeEventListener('beforeunload',warn);},[dirty]);

  const refreshStatus=async()=>{setRefreshing(true);setError('');try{await read(false);setNotice('Harness status refreshed.');}catch(issue){setError(message(issue));}finally{setRefreshing(false);}};
  const refreshAfterConfiguration=async()=>{const[next,catalog]=await Promise.all([harnessesApi.settings(),harnessesApi.catalog(undefined,true).catch(()=>undefined)]);setState(next);if(catalog)queryClient.setQueryData(harnessKeys.catalog,catalog);return next;};
  const saveSelected=async()=>{if(!state||!selected||!draft||!validDraft([draft]))return false;if(selected.enabled&&!draft.enabled&&selected.personas.length&&!confirm(`Disable ${selected.id}? ${selected.personas.length} agent routes will become unavailable.`))return false;setSaving(true);setError('');setNotice('');try{await harnessesApi.configure({instances:state.instances.map(instance=>instance.id===selected.id?configurationOf(draft):configurationOf(asDraft(instance)))});const next=await refreshAfterConfiguration(),saved=next.instances.find(instance=>instance.id===selected.id);if(saved)setDraft(asDraft(saved));setNotice(`${selected.id} saved.`);return true;}catch(issue){setError(message(issue));return false;}finally{setSaving(false);}};
  const test=async()=>{if(!draft||!validDraft([draft]))return;setTesting(true);setTestMessage(undefined);try{const result=await harnessesApi.testInstance({instance:configurationOf(draft)});setTestMessage(result.status==='healthy'?{text:'Connection is healthy.'}:{text:result.error?.message??'Connection test failed.',failed:true});}catch(issue){setTestMessage({text:message(issue),failed:true});}finally{setTesting(false);}};
  const remove=async()=>{if(!state||!selected||selected.personas.length||!confirm(`Remove ${selected.id}? This cannot be undone.`))return;setSaving(true);setError('');try{await harnessesApi.configure({instances:state.instances.filter(instance=>instance.id!==selected.id).map(instance=>configurationOf(asDraft(instance)))});await refreshAfterConfiguration();allowNavigation.current=true;navigate('/settings/harnesses',{replace:true});queueMicrotask(()=>{allowNavigation.current=false;});setNotice(`${selected.id} removed.`);}catch(issue){setError(message(issue));}finally{setSaving(false);}};
  const add=async(nextDraft:HarnessDraft)=>{if(!state||state.instances.some(instance=>instance.id===nextDraft.id)||!validDraft([...state.instances.map(asDraft),nextDraft]))throw new Error('Choose a unique, valid instance ID.');const tested=await harnessesApi.testInstance({instance:configurationOf(nextDraft)});if(tested.status!=='healthy')throw new Error(tested.error?.message??'Connection test failed.');await harnessesApi.configure({instances:[...state.instances.map(instance=>configurationOf(asDraft(instance))),configurationOf(nextDraft)]});await refreshAfterConfiguration();allowNavigation.current=true;navigate(`/settings/harnesses/${encodeURIComponent(nextDraft.id)}`);queueMicrotask(()=>{allowNavigation.current=false;});};
  const requestAdd=()=>{if(!dirty){setAddOpen(true);return;}setPendingAction(()=>()=>setAddOpen(true));};
  const discardAndContinue=()=>{setDraft(selected?asDraft(selected):undefined);if(blocker.state==='blocked')blocker.proceed();else pendingAction?.();setPendingAction(undefined);};
  const saveAndContinue=async()=>{if(!await saveSelected())return;if(blocker.state==='blocked')blocker.proceed();else pendingAction?.();setPendingAction(undefined);};
  const stay=()=>{if(blocker.state==='blocked')blocker.reset();setPendingAction(undefined);};
  const guardOpen=blocker.state==='blocked'||Boolean(pendingAction);

  return <main className={styles.shell}>
    <aside className={styles.rail}><Link to="/" className={styles.back}><ArrowLeft/>Workspace</Link><div><p>Settings</p><span className={styles.active}><Cable/>Harnesses</span></div><small>Local connector<br/>configuration</small></aside>
    <section className={styles.content}>
      <header className={styles.pageHeader}><span><strong><Cable/>Harnesses</strong><small>{summary.configured} configured · {summary.healthy} healthy · {summary.issues} issue{summary.issues===1?'':'s'}{summary.disabled?` · ${summary.disabled} disabled`:''}</small></span><div><Button type="button" disabled={refreshing||saving} icon={<RefreshCw className={refreshing?styles.spinning:''}/>} onClick={()=>void refreshStatus()}>{refreshing?'Refreshing…':'Refresh status'}</Button><Button type="button" variant="primary" icon={<Plus/>} onClick={requestAdd}>Add harness</Button></div></header>
      {error&&<Alert className={styles.pageAlert}>{error}</Alert>}{notice&&<p className={styles.notice} role="status">{notice}</p>}
      {loading&&!state?<div className={styles.loading}><Spinner label="Loading harness configuration…"/></div>:<div className={`${styles.masterDetail} ${instanceId?styles.mobileDetail:''}`}>
        <section className={styles.master} aria-label="Configured harness instances">
          <header><span><strong>Configured</strong><small>{summary.configured} instance{summary.configured===1?'':'s'}</small></span></header>
          <div className={styles.instanceList}>{groups.map(group=><section key={group.type} className={styles.instanceGroup}>{group.grouped&&<h2>{group.type}</h2>}{group.instances.map(instance=><HarnessInstanceRow key={instance.id} instance={instance} candidate={state?.candidates.find(candidate=>candidate.type===instance.type)} selected={instance.id===instanceId} onSelect={()=>navigate(`/settings/harnesses/${encodeURIComponent(instance.id)}`)}/>)}</section>)}</div>
          {!state?.instances.length&&<EmptyState compact className={styles.empty} icon={<Cable/>} title="No configured harnesses" description="Add a detected runtime or configure a custom endpoint."/>}
        </section>
        <section className={styles.detail} aria-label="Harness instance editor">{selected&&draft?<HarnessInstanceEditor saved={selected} draft={draft} saving={saving} testing={testing} testMessage={testMessage} onChange={next=>{setDraft(next);setNotice('');setTestMessage(undefined);}} onSave={()=>void saveSelected()} onCancel={()=>setDraft(asDraft(selected))} onTest={()=>void test()} onRemove={()=>void remove()} onBack={()=>navigate('/settings/harnesses')}/>:<EmptyState compact className={styles.noSelection} icon={<Cable/>} title={instanceId?'Harness not found':'Select a harness'} description={instanceId?'This instance no longer exists. Return to the configured list.':'Choose an instance to inspect health and edit its configuration.'}/>}</section>
      </div>}
    </section>
    <AddHarnessDrawer open={addOpen} state={state} onClose={()=>setAddOpen(false)} onRescan={async()=>{await read(true);}} onAdd={add}/>
    <Dialog open={guardOpen} title="Unsaved harness changes" description="Choose what to do with the current instance before leaving it." onClose={stay} footer={<><Button type="button" onClick={stay}>Stay</Button><Button type="button" variant="danger" onClick={discardAndContinue}>Discard</Button><Button type="button" variant="primary" disabled={saving} onClick={()=>void saveAndContinue()}>{saving?'Saving…':'Save & continue'}</Button></>}><p className={styles.guardCopy}>Only the selected instance has unsaved changes. Other harness configurations are unaffected.</p></Dialog>
  </main>;
};
