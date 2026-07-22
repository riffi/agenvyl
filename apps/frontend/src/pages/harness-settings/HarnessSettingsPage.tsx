import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,Cable,Plus,RefreshCw,Save} from 'lucide-react';
import {Link} from 'react-router-dom';
import type {HarnessSettingsState,SetupHarnessInstance} from '@agenvyl/contracts';
import {harnessesApi} from '../../entities/harness';
import {Alert,Button,EmptyState,Select,Spinner} from '../../shared/ui';
import {HarnessInstanceCard} from './HarnessInstanceCard';
import {addHarnessDraft,configurationOf,sameConfiguration,validDraft,type HarnessDraft} from './harnessSettingsModel';
import styles from './HarnessSettingsPage.module.css';

const harnessTypes:Array<{type:SetupHarnessInstance['type'];label:string}>=[{type:'hermes',label:'Hermes'},{type:'opencode',label:'OpenCode'},{type:'codex',label:'Codex'},{type:'antigravity',label:'Antigravity'}];
const message=(value:unknown)=>value instanceof Error?value.message:String(value);

export const HarnessSettingsPage=()=>{
  const[state,setState]=useState<HarnessSettingsState>();
  const[drafts,setDrafts]=useState<HarnessDraft[]>([]);
  const[addingType,setAddingType]=useState<SetupHarnessInstance['type']>('hermes');
  const[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const[checking,setChecking]=useState<string>(),[checks,setChecks]=useState<Record<string,string>>({});
  const dirty=useMemo(()=>Boolean(state&&!sameConfiguration(drafts,state.instances)),[drafts,state]);
  const valid=validDraft(drafts);

  const load=async()=>{setLoading(true);setError('');try{const next=await harnessesApi.settings();setState(next);setDrafts(next.instances);return next;}catch(issue){setError(message(issue));}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  useEffect(()=>{const beforeUnload=(event:BeforeUnloadEvent)=>{if(!dirty)return;event.preventDefault();};addEventListener('beforeunload',beforeUnload);return()=>removeEventListener('beforeunload',beforeUnload);},[dirty]);

  const add=()=>{setNotice('');setDrafts(current=>[...current,addHarnessDraft(addingType,current,state?.candidates??[])]);};
  const update=(index:number,next:HarnessDraft)=>{setNotice('');setDrafts(current=>current.map((item,itemIndex)=>itemIndex===index?next:item));};
  const remove=(index:number)=>{setNotice('');setDrafts(current=>current.filter((_,itemIndex)=>itemIndex!==index));};
  const save=async()=>{
    if(!valid)return;
    const affected=drafts.filter(instance=>!instance.enabled&&instance.personas.length);
    if(affected.length&&!confirm(`Disable ${affected.map(instance=>instance.id).join(', ')}? ${affected.reduce((sum,instance)=>sum+instance.personas.length,0)} agent routes will become unavailable.`))return;
    setSaving(true);setError('');setNotice('');
    try{await harnessesApi.configure({instances:drafts.map(configurationOf)});await load();setNotice('Harness configuration saved.');}
    catch(issue){setError(message(issue));}finally{setSaving(false);}
  };
  const check=async(instance:HarnessDraft)=>{
    if(dirty){setChecks(current=>({...current,[instance.id]:'Save pending changes before testing this connection.'}));return;}
    setChecking(instance.id);setChecks(current=>({...current,[instance.id]:''}));
    const next=await load();
    const result=next?.instances.find(item=>item.id===instance.id);
    setChecks(current=>({...current,[instance.id]:result?.status==='healthy'?'Connection is healthy.':result?.error?.message??`Connection status: ${result?.status??'unavailable'}.`}));
    setChecking(undefined);
  };

  return <main className={styles.shell}>
    <aside className={styles.rail}><Link to="/" className={styles.back} onClick={event=>{if(dirty&&!confirm('Discard unsaved harness configuration changes?'))event.preventDefault();}}><ArrowLeft/>Workspace</Link><div><p>Settings</p><span className={styles.active}><Cable/>Harnesses</span></div><small>Local connector<br/>configuration</small></aside>
    <section className={styles.content}>
      <header className={styles.pageHeader}><span><strong><Cable/>Harnesses</strong><small>{state?`${state.instances.length} configured instance${state.instances.length===1?'':'s'}`:'Local connector configuration'}</small></span><Button type="button" disabled={loading||dirty} title={dirty?'Save or discard changes before rescanning':'Discover harnesses and refresh status'} icon={<RefreshCw className={loading?styles.spinning:''}/>} onClick={()=>void load()}>Rescan</Button></header>
      <div className={styles.pageBody}>
        <p className={styles.description}>Connect the runtimes your agents use. Configuration stays local to this machine.</p>
        {error&&<Alert>{error}</Alert>}{notice&&<p className={styles.notice} role="status">{notice}</p>}
        <div className={styles.addBar}><span><strong>Add a harness instance</strong><small>Multiple instances of the same harness are supported.</small></span><Select aria-label="Harness type" value={addingType} onChange={event=>setAddingType(event.target.value as SetupHarnessInstance['type'])}>{harnessTypes.map(item=><option key={item.type} value={item.type}>{item.label}</option>)}</Select><Button type="button" variant="primary" icon={<Plus/>} onClick={add}>Add instance</Button></div>
        {loading&&!state?<div className={styles.loading}><Spinner label="Discovering local harnesses…"/></div>:<div className={styles.instances}>{drafts.map((instance,index)=><HarnessInstanceCard key={`${instance.id}-${index}`} instance={instance} isNew={!state?.instances.some(saved=>saved.id===instance.id)} checking={checking===instance.id} checkMessage={checks[instance.id]} onChange={next=>update(index,next)} onRemove={()=>remove(index)} onCheck={()=>void check(instance)}/>)}</div>}
        {!loading&&!drafts.length&&<EmptyState compact className={styles.empty} icon={<Cable/>} title="No harnesses configured" description="Add an instance above or rescan after installing a supported harness."/>}
      </div>
      <footer className={styles.saveBar}><span>{dirty?'Unsaved configuration changes':state?`${state.instances.length} configured instance${state.instances.length===1?'':'s'}`:'Configuration unavailable'}</span><Button type="button" variant="primary" icon={<Save/>} disabled={!dirty||!valid||saving} onClick={()=>void save()}>{saving?'Saving…':'Save changes'}</Button></footer>
    </section>
  </main>;
};
