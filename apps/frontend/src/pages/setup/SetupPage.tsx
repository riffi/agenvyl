import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {CircleHelp,FolderOpen} from 'lucide-react';
import type {CompleteSetupRequest,SetupHarnessCandidate,SetupHarnessInstance,SetupState} from '@agenvyl/contracts';
import {HarnessIcon} from '../../entities/harness';
import {apiRequest} from '../../shared/api';
import {handleAfterNameChange} from '../../shared/lib';
import styles from './SetupPage.module.css';

type Catalog={instances:Array<{id:string;type:string;status:string;models:Array<{id:string;label?:string}>;controls:{permissionProfiles:Array<{id:string}>;agentVariants:Array<{id:string}>}}>};
type SetupHarnessOptions={openCodeManaged?:boolean;claudeOAuthConfirmed?:boolean};

export function SetupPage(){
  const navigate=useNavigate(),location=useLocation(),configure=new URLSearchParams(location.search).get('configure')==='1',preview=isSetupPreview(location.search,import.meta.env.DEV);
  const [state,setState]=useState<SetupState>(),[selected,setSelected]=useState<string[]>([]);
  const [agy,setAgy]=useState(false),[agyConfirmation,setAgyConfirmation]=useState('');
  const [openCodeManaged,setOpenCodeManaged]=useState(true);
  const [claudeOAuthConfirmation,setClaudeOAuthConfirmation]=useState('');
  const [cursorConfirmation,setCursorConfirmation]=useState('');
  const [name,setName]=useState('User'),[handle,setHandle]=useState('user'),[workspaceRoot,setWorkspaceRoot]=useState(''),[choosingRoot,setChoosingRoot]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(configure){navigate('/settings/harnesses',{replace:true});return;}void apiRequest<SetupState>('/api/v1/setup').then(value=>{
    const initial=initialConnectorSelection(value);
    setState(value);setSelected(initial.selected);setAgy(initial.agy);setOpenCodeManaged(initial.openCodeManaged);setWorkspaceRoot(value.workspaceRoot);
    setClaudeOAuthConfirmation(initial.claudeOAuthConfirmed?'CLAUDE OAUTH':'');
    setCursorConfirmation(initial.cursorConfirmed?'CURSOR':'');
    if(value.completed&&value.firstRoomId&&!preview)navigate(`/rooms/${value.firstRoomId}`,{replace:true});
  }).catch(issue=>setError(message(issue)));},[configure,navigate,preview]);
  useEffect(()=>{
    if(state?.discoveryCache.state!=='refreshing')return;
    const timer=window.setInterval(()=>void apiRequest<SetupState>('/api/v1/setup').then(setState).catch(issue=>setError(message(issue))),2_000);
    return()=>window.clearInterval(timer);
  },[state?.discoveryCache.state]);
  const safe=useMemo(()=>state?.candidates.filter(candidate=>candidate.safeToSelect&&!candidate.requiresConfirmation).map(candidate=>candidate.type)??[],[state]);
  const normalizedHandle=handle.trim().replace(/^@/,'').toLowerCase();
  const handleIssue=normalizedHandle&&!/^[a-z0-9][a-z0-9_-]*$/.test(normalizedHandle)?'Use only a-z, 0-9, _, or -; start with a letter or digit.':undefined;
  const claudeNeedsConfirmation=Boolean(state?.candidates.some(candidate=>candidate.type==='claude'&&candidate.requiresConfirmation==='claude_oauth'&&selected.includes('claude')));
  const cursorNeedsConfirmation=Boolean(state?.candidates.some(candidate=>candidate.type==='cursor'&&candidate.requiresConfirmation==='cursor_experimental'&&selected.includes('cursor')));
  const toggle=(candidate:SetupHarnessCandidate)=>setSelected(value=>value.includes(candidate.type)?value.filter(item=>item!==candidate.type):[...value,candidate.type]);
  const chooseWorkspaceRoot=async()=>{setChoosingRoot(true);setError('');try{const result=await apiRequest<{path:string|null}>('/api/v1/setup/workspace-directory',{method:'POST',body:{}});if(result.path)setWorkspaceRoot(result.path);}catch(issue){setError(message(issue));}finally{setChoosingRoot(false);}};
  const submit=async(event:FormEvent)=>{event.preventDefault();
    if(preview){setError('Development preview is read-only. No setup changes were saved.');return;}
    if(agy&&agyConfirmation!=='AGY'){setError('Type AGY to confirm');return;}
    if(claudeNeedsConfirmation&&claudeOAuthConfirmation!=='CLAUDE OAUTH'){setError('Type CLAUDE OAUTH to confirm');return;}
    if(cursorNeedsConfirmation&&cursorConfirmation!=='CURSOR'){setError('Type CURSOR to confirm');return;}
    setBusy(true);setError('');try{
    const options:SetupHarnessOptions={openCodeManaged,claudeOAuthConfirmed:claudeOAuthConfirmation==='CLAUDE OAUTH'};
    const instances=state?mergeSetupHarnessSelection(state,selected,agy,options):[];
    await apiRequest('/api/v1/setup/harnesses',{method:'PUT',body:{instances}});
    if(configure&&state?.firstRoomId){navigate(`/rooms/${state.firstRoomId}`,{replace:true});return;}
    const catalog=instances.length?await apiRequest<Catalog>('/api/v1/harnesses?refresh=true'):undefined;
    const first=catalog?.instances.find(instance=>instance.status!=='unavailable'&&instance.models.length);
    const route:CompleteSetupRequest['route']=first?{harness_instance_id:first.id,harness_type:first.type,model_id:first.models[0].id,permission_profile_id:first.controls.permissionProfiles[0]?.id??null,agent_variant_id:first.controls.agentVariants[0]?.id??null}:null;
    const result=await apiRequest<{roomId:string}>('/api/v1/setup/complete',{method:'POST',body:setupCompletionRequest({workspaceRoot,name,handle,route})});navigate(`/rooms/${result.roomId}`,{replace:true});
  }catch(issue){setError(message(issue));}finally{setBusy(false);}};
  if(configure)return null;
  if(!state&&!error)return <main className={styles.shell}><p>Checking installation…</p></main>;
  return <main className={styles.shell}><form className={styles.card} onSubmit={submit}>
    <header><p className={styles.eyebrow}>Agenvyl</p><h1>{preview?'Workspace setup preview':configure?'Connector settings':'Workspace setup'}</h1><p>Choose local agent runtimes and review how Agenvyl may use them.</p></header>
    {preview&&<p className={styles.previewBanner} role="status"><strong>Development preview</strong><span>You can explore the completed setup flow, but this page will not write configuration or installation data.</span></p>}
    <section>
      <div className={styles.sectionTitle}><h2><FieldTitle label="Connectors" help="Connectors are local integrations that let Agenvyl discover and run coding agents installed on this computer. Select the tools you want Agenvyl to use; you can change them later."/></h2><button type="button" className={styles.link} onClick={()=>setSelected(safe)}>Select safe</button></div>
      <div className={styles.options}>{state?.candidates.filter(candidate=>candidate.type!=='antigravity').map(candidate=><Candidate key={candidate.type} candidate={candidate} checked={selected.includes(candidate.type)} onChange={()=>toggle(candidate)}/>)}</div>
      {state?.candidates.some(candidate=>candidate.type==='antigravity')&&<div className={styles.additionalConnector}><span className={styles.subsectionLabel}>Requires explicit opt-in</span><section className={styles.danger}><label className={styles.dangerChoice}><input type="checkbox" checked={agy} onChange={event=>{setAgy(event.target.checked);if(!event.target.checked)setAgyConfirmation('')}}/><HarnessIcon type="antigravity" size="md"/><span><strong>AGY</strong> — separate subprocess with a dangerous permission flag</span></label></section></div>}
    </section>
    <ConnectorOptions
      selected={selected}
      agy={agy}
      agyConfirmation={agyConfirmation}
      setAgyConfirmation={setAgyConfirmation}
      openCodeManaged={openCodeManaged}
      setOpenCodeManaged={setOpenCodeManaged}
      claudeNeedsConfirmation={claudeNeedsConfirmation}
      claudeOAuthConfirmation={claudeOAuthConfirmation}
      setClaudeOAuthConfirmation={setClaudeOAuthConfirmation}
      cursorNeedsConfirmation={cursorNeedsConfirmation}
      cursorConfirmation={cursorConfirmation}
      setCursorConfirmation={setCursorConfirmation}
    />
    {!configure&&<section className={styles.grid}>
      <label><FieldTitle label="Display name" help="The name other participants will see for you in rooms and messages."/><input value={name} onChange={event=>{const nextName=event.target.value;setHandle(current=>handleAfterNameChange(name,nextName,current));setName(nextName);}} required/></label>
      <label className={styles.handleField}><FieldTitle label="Handle" help="Your unique @name for mentions. It follows your display name until you edit it manually."/><span className={`${styles.handleWrap} ${handleIssue?styles.invalid:''}`}><b aria-hidden="true">@</b><input aria-label="User handle" placeholder="for example, alex_smith" value={handle} onChange={event=>setHandle(event.target.value.toLowerCase().replace(/^@/,''))} pattern="[a-z0-9][a-z0-9_-]*" required/></span><small className={`${styles.handleMessage} ${handleIssue?styles.handleError:normalizedHandle?styles.available:''}`}>{handleIssue??(normalizedHandle?`@${normalizedHandle} — available`:'Used in mentions.')}</small></label>
      <label className={styles.wide}><FieldTitle label="Workspace root" help="The local folder where Agenvyl stores room files and agent workspaces."/><span className={styles.pathField}><input value={workspaceRoot} onChange={event=>setWorkspaceRoot(event.target.value)} required spellCheck={false}/><button type="button" className={styles.browse} onClick={chooseWorkspaceRoot} disabled={choosingRoot} aria-label="Choose workspace root folder"><FolderOpen/>{choosingRoot?'Choosing…':'Choose…'}</button></span></label>
    </section>}
    {state&&state.discoveryCache.state!=='fresh'&&<p className={styles.cacheWarning} role="status">Harness discovery is {state.discoveryCache.state}. Showing the last known candidates{cacheTime(state.discoveryCache.refreshedAt)}.</p>}
    {error&&<p className={styles.error} role="alert">{error}</p>}<button className={styles.primary} disabled={busy||preview}>{busy?'Setting up…':preview?'Preview only':configure?'Save connectors':'Create workspace'}</button><p className={styles.note}>{preview?'Open /setup normally to use the real installation flow.':'You can continue without connectors and add them later.'}</p>
  </form></main>;
}

export function FieldTitle({label,help}:{label:string;help:string}){return <span className={styles.fieldTitle}>{label}<span className={styles.fieldHelp} tabIndex={0} aria-label={help}><CircleHelp aria-hidden="true"/><span className={styles.fieldTooltip} role="tooltip">{help}</span></span></span>}

export function setupCompletionRequest({workspaceRoot,name,handle,route}:{workspaceRoot:string;name:string;handle:string;route:CompleteSetupRequest['route']}):CompleteSetupRequest{return{locale:'en',workspace_root:workspaceRoot.trim(),profile:{display_name:name,handle},route};}

export function Candidate({candidate,checked,onChange}:{candidate:SetupHarnessCandidate;checked:boolean;onChange:()=>void}){const available=candidate.safeToSelect;return <label className={`${styles.option} ${available?'':styles.unavailable}`}><input type="checkbox" checked={checked} disabled={!available&&!checked} onChange={onChange}/><HarnessIcon type={candidate.type} size="md"/><span><strong>{candidate.label}</strong><small>{candidate.endpoint?.reachable?'Endpoint ready':candidate.cli.found?`${candidate.cli.version??'CLI'} detected`:'Not detected'}</small></span></label>}
export function ConnectorOptions({selected,agy,agyConfirmation,setAgyConfirmation,openCodeManaged,setOpenCodeManaged,claudeNeedsConfirmation,claudeOAuthConfirmation,setClaudeOAuthConfirmation,cursorNeedsConfirmation=false,cursorConfirmation='',setCursorConfirmation=()=>undefined}:{
  selected:string[];
  agy:boolean;
  agyConfirmation:string;
  setAgyConfirmation:(value:string)=>void;
  openCodeManaged:boolean;
  setOpenCodeManaged:(value:boolean)=>void;
  claudeNeedsConfirmation:boolean;
  claudeOAuthConfirmation:string;
  setClaudeOAuthConfirmation:(value:string)=>void;
  cursorNeedsConfirmation?:boolean;
  cursorConfirmation?:string;
  setCursorConfirmation?:(value:string)=>void;
}){
  if(!selected.includes('opencode')&&!agy&&!claudeNeedsConfirmation&&!cursorNeedsConfirmation)return null;
  return <section className={styles.connectorSettings} aria-labelledby="connector-options-title">
    <div className={styles.subsectionTitle}><span><h3 id="connector-options-title">Connector options</h3><small>Settings for the runtimes selected above.</small></span></div>
    <div className={styles.settingList}>
      {selected.includes('opencode')&&<div className={styles.setting}><label className={styles.settingChoice}><input type="checkbox" checked={openCodeManaged} onChange={event=>setOpenCodeManaged(event.target.checked)}/><span><strong>Managed server</strong><small>Start and stop OpenCode with Agenvyl instead of relying on an existing endpoint.</small></span><em>OpenCode</em></label></div>}
      {agy&&<div className={`${styles.setting} ${styles.settingDanger}`}><div className={styles.requiredSetting}><i aria-hidden="true"/><span><strong>Confirm dangerous permission mode</strong><small>AGY runs as a separate subprocess with a dangerous permission flag.</small></span><em>AGY</em></div><label className={styles.confirmation}><span>Confirmation phrase</span><input type="text" value={agyConfirmation} onChange={event=>setAgyConfirmation(event.target.value)} placeholder="Type AGY" autoComplete="off"/></label></div>}
      {claudeNeedsConfirmation&&<div className={`${styles.setting} ${styles.settingDanger}`}><div className={styles.requiredSetting}><i aria-hidden="true"/><span><strong>Confirm subscription OAuth</strong><small>This experimental integration may conflict with Anthropic terms for third-party products.</small></span><em>Claude</em></div><label className={styles.confirmation}><span>Confirmation phrase</span><input type="text" value={claudeOAuthConfirmation} onChange={event=>setClaudeOAuthConfirmation(event.target.value)} placeholder="Type CLAUDE OAUTH" autoComplete="off"/></label></div>}
      {cursorNeedsConfirmation&&<div className={`${styles.setting} ${styles.settingDanger}`}><div className={styles.requiredSetting}><i aria-hidden="true"/><span><strong>Confirm experimental Cursor CLI</strong><small>Cursor rules, MCP servers, and hooks remain active, and Work has no per-action approval bridge.</small></span><em>Cursor</em></div><label className={styles.confirmation}><span>Confirmation phrase</span><input type="text" value={cursorConfirmation} onChange={event=>setCursorConfirmation(event.target.value)} placeholder="Type CURSOR" autoComplete="off"/></label></div>}
    </div>
  </section>;
}
export function initialConnectorSelection(state:SetupState){
  const enabled=new Set(state.instances.filter(instance=>instance.enabled).map(instance=>instance.type));
  const selectable=new Set<string>(state.candidates.filter(candidate=>candidate.safeToSelect&&!candidate.requiresConfirmation).map(candidate=>candidate.type));
  const openCode=state.instances.find(instance=>instance.type==='opencode');
  return{
    selected:[...enabled].filter(type=>type!=='antigravity'&&(state.completed||selectable.has(type))),
    agy:state.completed&&enabled.has('antigravity'),
    openCodeManaged:openCode?.managed??true,
    claudeOAuthConfirmed:state.instances.some(instance=>instance.type==='claude'&&instance.allowSubscriptionOAuth),
    cursorConfirmed:state.completed&&enabled.has('cursor'),
  };
}
export function instanceConfig(candidate:SetupHarnessCandidate,existing?:SetupState['instances'][number],options:SetupHarnessOptions={},id=`local-${candidate.type}`):SetupHarnessInstance{return{id:existing?.id??id,type:candidate.type,enabled:true,...(existing?.endpoint?{endpoint:existing.endpoint}:{}),...(!existing?.endpoint&&candidate.endpoint&&!['codex','claude','cursor'].includes(candidate.type)?{endpoint:candidate.endpoint.url}:{}),...(candidate.type==='opencode'?{managed:options.openCodeManaged??existing?.managed??true,externalDirectoryRoots:existing?.externalDirectoryRoots??[]}:{}),...(candidate.type==='claude'?{allowSubscriptionOAuth:candidate.requiresConfirmation==='claude_oauth'&&(options.claudeOAuthConfirmed??existing?.allowSubscriptionOAuth??false)}:{})};}
export function mergeSetupHarnessSelection(state:SetupState,selected:string[],agy:boolean,options:SetupHarnessOptions={}):SetupHarnessInstance[]{
  const configurable=new Map(state.candidates.filter(candidate=>candidate.safeToSelect||(candidate.type==='antigravity'&&candidate.cli.found&&candidate.cli.compatible!==false)).map(candidate=>[candidate.type,candidate]));
  const selectedTypes=new Set<SetupHarnessInstance['type']>([...selected.filter(isHarnessType),...(agy?['antigravity' as const]:[])]);
  const typeCounts=new Map<SetupHarnessInstance['type'],number>();for(const instance of state.instances)typeCounts.set(instance.type,(typeCounts.get(instance.type)??0)+1);
  const result:SetupHarnessInstance[]=state.instances.map(({status:_status,error:_error,...instance})=>{
    const candidate=configurable.get(instance.type);if(!candidate)return instance;
    const enabled=selectedTypes.has(instance.type);
    if(!enabled)return{...instance,enabled:false};
    return instanceConfig(candidate,{...instance,status:'healthy'},typeCounts.get(instance.type)===1?options:{});
  });
  for(const type of selectedTypes){
    if(result.some(instance=>instance.type===type))continue;
    const candidate=configurable.get(type);if(!candidate)continue;
    result.push(instanceConfig(candidate,undefined,options,uniqueInstanceId(type,result)));
  }
  return result;
}
function uniqueInstanceId(type:string,instances:SetupHarnessInstance[]){const base=`local-${type}`;let id=base,index=2;while(instances.some(instance=>instance.id===id))id=`${base}-${index++}`;return id;}
function isHarnessType(value:string):value is SetupHarnessInstance['type']{return['hermes','opencode','antigravity','codex','claude','cursor'].includes(value);}
export const isSetupPreview=(search:string,development:boolean)=>development&&new URLSearchParams(search).get('preview')==='1';
function message(value:unknown){return value instanceof Error?value.message:'Setup failed';}
const cacheTime=(value:string|null)=>value?` from ${new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`:'';
