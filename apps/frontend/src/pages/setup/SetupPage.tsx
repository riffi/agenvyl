import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import type {CompleteSetupRequest,SetupHarnessCandidate,SetupHarnessInstance,SetupState} from '@agenvyl/contracts';
import {HarnessIcon} from '../../entities/harness';
import {apiRequest} from '../../shared/api';
import styles from './SetupPage.module.css';

type Catalog={instances:Array<{id:string;type:string;status:string;models:Array<{id:string;label?:string}>;controls:{permissionProfiles:Array<{id:string}>;agentVariants:Array<{id:string}>}}>};
type SetupHarnessOptions={openCodeManaged?:boolean;codexDangerFullAccess?:boolean;claudeOAuthConfirmed?:boolean};

export function SetupPage(){
  const navigate=useNavigate(),location=useLocation(),configure=new URLSearchParams(location.search).get('configure')==='1';
  const [state,setState]=useState<SetupState>(),[selected,setSelected]=useState<string[]>([]);
  const [agy,setAgy]=useState(false),[agyConfirmation,setAgyConfirmation]=useState('');
  const [openCodeManaged,setOpenCodeManaged]=useState(true);
  const [codexDangerFullAccess,setCodexDangerFullAccess]=useState(false),[codexConfirmation,setCodexConfirmation]=useState('');
  const [claudeOAuthConfirmation,setClaudeOAuthConfirmation]=useState('');
  const [name,setName]=useState('User'),[handle,setHandle]=useState('user'),[roomTitle,setRoomTitle]=useState('First room'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(configure){navigate('/settings/harnesses',{replace:true});return;}void apiRequest<SetupState>('/api/v1/setup').then(value=>{
    const initial=initialConnectorSelection(value);
    setState(value);setSelected(initial.selected);setAgy(initial.agy);setOpenCodeManaged(initial.openCodeManaged);setCodexDangerFullAccess(initial.codexDangerFullAccess);
    setClaudeOAuthConfirmation(initial.claudeOAuthConfirmed?'CLAUDE OAUTH':'');
    if(value.completed&&value.firstRoomId)navigate(`/rooms/${value.firstRoomId}`,{replace:true});
  }).catch(issue=>setError(message(issue)));},[configure,navigate]);
  const safe=useMemo(()=>state?.candidates.filter(candidate=>candidate.safeToSelect&&!candidate.requiresConfirmation).map(candidate=>candidate.type)??[],[state]);
  const claudeNeedsConfirmation=Boolean(state?.candidates.some(candidate=>candidate.type==='claude'&&candidate.requiresConfirmation==='claude_oauth'&&selected.includes('claude')));
  const toggle=(candidate:SetupHarnessCandidate)=>setSelected(value=>value.includes(candidate.type)?value.filter(item=>item!==candidate.type):[...value,candidate.type]);
  const submit=async(event:FormEvent)=>{event.preventDefault();
    if(agy&&agyConfirmation!=='AGY'){setError('Type AGY to confirm');return;}
    if(codexDangerFullAccess&&selected.includes('codex')&&codexConfirmation!=='CODEX FULL ACCESS'){setError('Type CODEX FULL ACCESS to confirm');return;}
    if(claudeNeedsConfirmation&&claudeOAuthConfirmation!=='CLAUDE OAUTH'){setError('Type CLAUDE OAUTH to confirm');return;}
    setBusy(true);setError('');try{
    const options:SetupHarnessOptions={openCodeManaged,codexDangerFullAccess,claudeOAuthConfirmed:claudeOAuthConfirmation==='CLAUDE OAUTH'};
    const instances:SetupHarnessInstance[]=(state?.candidates??[]).filter(candidate=>selected.includes(candidate.type)||(candidate.type==='antigravity'&&agy)).map(candidate=>instanceConfig(candidate,state?.instances.find(instance=>instance.type===candidate.type),options));
    await apiRequest('/api/v1/setup/harnesses',{method:'PUT',body:{instances}});
    if(configure&&state?.firstRoomId){navigate(`/rooms/${state.firstRoomId}`,{replace:true});return;}
    const catalog=instances.length?await apiRequest<Catalog>('/api/v1/harnesses'):undefined;
    const first=catalog?.instances.find(instance=>instance.status!=='unavailable'&&instance.models.length);
    const route:CompleteSetupRequest['route']=first?{harness_instance_id:first.id,harness_type:first.type,model_id:first.models[0].id,permission_profile_id:first.controls.permissionProfiles[0]?.id??null,agent_variant_id:first.controls.agentVariants[0]?.id??null}:null;
    const result=await apiRequest<{roomId:string}>('/api/v1/setup/complete',{method:'POST',body:{locale:'en',workspace_root:state?.workspaceRoot??'',profile:{display_name:name,handle},room_title:roomTitle,route} satisfies CompleteSetupRequest});navigate(`/rooms/${result.roomId}`,{replace:true});
  }catch(issue){setError(message(issue));}finally{setBusy(false);}};
  if(configure)return null;
  if(!state&&!error)return <main className={styles.shell}><p>Checking installation…</p></main>;
  return <main className={styles.shell}><form className={styles.card} onSubmit={submit}>
    <header><p className={styles.eyebrow}>Agenvyl</p><h1>{configure?'Connector settings':'Workspace setup'}</h1><p>Choose local agent runtimes and review how Agenvyl may use them.</p></header>
    <section><div className={styles.sectionTitle}><h2>Connectors</h2><button type="button" className={styles.link} onClick={()=>setSelected(safe)}>Select safe</button></div><div className={styles.options}>{state?.candidates.filter(candidate=>candidate.type!=='antigravity').map(candidate=><Candidate key={candidate.type} candidate={candidate} checked={selected.includes(candidate.type)} onChange={()=>toggle(candidate)}/>)}</div></section>
    <div className={styles.connectorSettings}>
      {selected.includes('opencode')&&<section className={styles.setting}><label className={styles.settingChoice}><input type="checkbox" checked={openCodeManaged} onChange={event=>setOpenCodeManaged(event.target.checked)}/><HarnessIcon type="opencode" size="md"/><span><strong>Managed OpenCode server</strong><small>Use an existing server at the endpoint, or start and stop one with Agenvyl when needed.</small></span></label></section>}
      {selected.includes('codex')&&<section className={codexDangerFullAccess?styles.danger:styles.setting}><label className={styles.settingChoice}><input type="checkbox" checked={codexDangerFullAccess} onChange={event=>{setCodexDangerFullAccess(event.target.checked);if(!event.target.checked)setCodexConfirmation('');}}/><HarnessIcon type="codex" size="md"/><span><strong>Allow danger-full-access</strong><small>Expose an unsandboxed Codex mode that runs without approval prompts.</small></span></label>{codexDangerFullAccess&&<input type="text" value={codexConfirmation} onChange={event=>setCodexConfirmation(event.target.value)} placeholder="Type CODEX FULL ACCESS" autoComplete="off"/>}</section>}
      {claudeNeedsConfirmation&&<section className={styles.danger}><div className={styles.settingChoice}><HarnessIcon type="claude" size="md"/><span><strong>Confirm Claude subscription OAuth</strong><small>This experimental integration may conflict with Anthropic terms for third-party products.</small></span></div><input type="text" value={claudeOAuthConfirmation} onChange={event=>setClaudeOAuthConfirmation(event.target.value)} placeholder="Type CLAUDE OAUTH" autoComplete="off"/></section>}
    </div>
    {state?.candidates.some(candidate=>candidate.type==='antigravity')&&<section className={styles.danger}><label className={styles.dangerChoice}><input type="checkbox" checked={agy} onChange={event=>setAgy(event.target.checked)}/><HarnessIcon type="antigravity" size="md"/><span><strong>AGY</strong> — separate subprocess with a dangerous permission flag</span></label>{agy&&<input value={agyConfirmation} onChange={event=>setAgyConfirmation(event.target.value)} placeholder="Type AGY" />}</section>}
    {!configure&&<section className={styles.grid}><label>Display name<input value={name} onChange={event=>setName(event.target.value)} required/></label><label>Handle<input value={handle} onChange={event=>setHandle(event.target.value)} pattern="[a-z0-9][a-z0-9_-]*" required/></label><label className={styles.wide}>Workspace root<input value={state?.workspaceRoot??''} readOnly/></label><label className={styles.wide}>First room<input value={roomTitle} onChange={event=>setRoomTitle(event.target.value)} required/></label></section>}
    {error&&<p className={styles.error} role="alert">{error}</p>}<button className={styles.primary} disabled={busy}>{busy?'Setting up…':configure?'Save connectors':'Create workspace'}</button><p className={styles.note}>You can continue without connectors and add them later.</p>
  </form></main>;
}

export function Candidate({candidate,checked,onChange}:{candidate:SetupHarnessCandidate;checked:boolean;onChange:()=>void}){const available=candidate.safeToSelect;return <label className={`${styles.option} ${available?'':styles.unavailable}`}><input type="checkbox" checked={checked} disabled={!available&&!checked} onChange={onChange}/><HarnessIcon type={candidate.type} size="md"/><span><strong>{candidate.label}</strong><small>{candidate.endpoint?.reachable?'Endpoint ready':candidate.cli.found?`${candidate.cli.version??'CLI'} detected`:'Not detected'}</small></span></label>}
export function initialConnectorSelection(state:SetupState){
  const enabled=new Set(state.instances.map(instance=>instance.type));
  const selectable=new Set<string>(state.candidates.filter(candidate=>candidate.safeToSelect&&!candidate.requiresConfirmation).map(candidate=>candidate.type));
  const openCode=state.instances.find(instance=>instance.type==='opencode');
  const codex=state.instances.find(instance=>instance.type==='codex');
  return{
    selected:[...enabled].filter(type=>type!=='antigravity'&&(state.completed||selectable.has(type))),
    agy:state.completed&&enabled.has('antigravity'),
    openCodeManaged:openCode?.managed??true,
    codexDangerFullAccess:codex?.allowDangerFullAccess??false,
    claudeOAuthConfirmed:state.instances.some(instance=>instance.type==='claude'&&instance.allowSubscriptionOAuth),
  };
}
export function instanceConfig(candidate:SetupHarnessCandidate,existing?:SetupState['instances'][number],options:SetupHarnessOptions={}):SetupHarnessInstance{return{id:`local-${candidate.type}`,type:candidate.type,enabled:true,...(candidate.endpoint&&candidate.type!=='codex'&&candidate.type!=='claude'?{endpoint:candidate.endpoint.url}:{}),...(candidate.type==='opencode'?{managed:options.openCodeManaged??existing?.managed??true}:{}),...(candidate.type==='antigravity'?{permissionMode:'plan' as const}:{}),...(candidate.type==='codex'?{allowDangerFullAccess:options.codexDangerFullAccess??existing?.allowDangerFullAccess??false}:{}),...(candidate.type==='claude'?{allowSubscriptionOAuth:candidate.requiresConfirmation==='claude_oauth'&&(options.claudeOAuthConfirmed??existing?.allowSubscriptionOAuth??false)}:{})};}
function message(value:unknown){return value instanceof Error?value.message:'Setup failed';}
