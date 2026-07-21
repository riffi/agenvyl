import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {useNavigate} from 'react-router-dom';
import type {CompleteSetupRequest,SetupHarnessCandidate,SetupHarnessInstance,SetupState} from '@agenvyl/contracts';
import {apiRequest} from '../../shared/api';
import styles from './SetupPage.module.css';

type Catalog={instances:Array<{id:string;type:string;status:string;models:Array<{id:string;label?:string}>;modes:Array<{id:string;label?:string}>}>};

export function SetupPage(){
  const navigate=useNavigate(),[state,setState]=useState<SetupState>(),[selected,setSelected]=useState<string[]>([]),[agy,setAgy]=useState(false),[agyConfirmation,setAgyConfirmation]=useState(''),[locale,setLocale]=useState<'en'|'ru'>('en'),[name,setName]=useState('User'),[handle,setHandle]=useState('user'),[roomTitle,setRoomTitle]=useState('First room'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void apiRequest<SetupState>('/api/v1/setup').then(value=>{setState(value);setLocale(value.locale);if(value.completed&&value.firstRoomId)navigate(`/rooms/${value.firstRoomId}`,{replace:true});}).catch(issue=>setError(message(issue)));},[navigate]);
  const safe=useMemo(()=>state?.candidates.filter(candidate=>candidate.safeToSelect).map(candidate=>candidate.type)??[],[state]);
  const toggle=(type:string)=>setSelected(value=>value.includes(type)?value.filter(item=>item!==type):[...value,type]);
  const submit=async(event:FormEvent)=>{event.preventDefault();if(agy&&agyConfirmation!=='AGY'){setError(locale==='ru'?'Введите AGY для подтверждения':'Type AGY to confirm');return;}setBusy(true);setError('');try{
    const instances:SetupHarnessInstance[]=(state?.candidates??[]).filter(candidate=>selected.includes(candidate.type)||(candidate.type==='antigravity'&&agy)).map(instanceConfig);
    await apiRequest('/api/v1/setup/harnesses',{method:'PUT',body:{instances}});
    const catalog=instances.length?await apiRequest<Catalog>('/api/v1/harnesses'):undefined;
    const first=catalog?.instances.find(instance=>instance.status!=='unavailable'&&instance.models.length);
    const route:CompleteSetupRequest['route']=first?{harness_instance_id:first.id,harness_type:first.type,model_id:first.models[0].id,mode_id:first.type==='antigravity'?'plan':first.modes[0]?.id??null}:null;
    const result=await apiRequest<{roomId:string}>('/api/v1/setup/complete',{method:'POST',body:{locale,workspace_root:state?.workspaceRoot??'',profile:{display_name:name,handle},room_title:roomTitle,route} satisfies CompleteSetupRequest});navigate(`/rooms/${result.roomId}`,{replace:true});
  }catch(issue){setError(message(issue));}finally{setBusy(false);}};
  if(!state&&!error)return <main className={styles.shell}><p>{locale==='ru'?'Проверяем установку…':'Checking installation…'}</p></main>;
  return <main className={styles.shell}><form className={styles.card} onSubmit={submit}>
    <header><div className={styles.locale}><button type="button" onClick={()=>setLocale('en')} aria-pressed={locale==='en'}>EN</button><button type="button" onClick={()=>setLocale('ru')} aria-pressed={locale==='ru'}>RU</button></div><p className={styles.eyebrow}>Agenvyl</p><h1>{locale==='ru'?'Настройка рабочего пространства':'Workspace setup'}</h1><p>{locale==='ru'?'Выберите локальные инструменты. Безопасные подключения не запускают внешние процессы без вашего решения.':'Choose local tools. Safe connections do not start external processes without your decision.'}</p></header>
    <section><div className={styles.sectionTitle}><h2>{locale==='ru'?'Инструменты':'Harnesses'}</h2><button type="button" className={styles.link} onClick={()=>setSelected(safe)}>{locale==='ru'?'Выбрать безопасные':'Select safe'}</button></div><div className={styles.options}>{state?.candidates.filter(candidate=>candidate.type!=='antigravity').map(candidate=><Candidate key={candidate.type} candidate={candidate} checked={selected.includes(candidate.type)} onChange={()=>toggle(candidate.type)}/>)}</div></section>
    {state?.candidates.some(candidate=>candidate.type==='antigravity')&&<section className={styles.danger}><label><input type="checkbox" checked={agy} onChange={event=>setAgy(event.target.checked)}/> <strong>AGY</strong> — {locale==='ru'?'отдельный subprocess с опасным permission-флагом':'separate subprocess with a dangerous permission flag'}</label>{agy&&<input value={agyConfirmation} onChange={event=>setAgyConfirmation(event.target.value)} placeholder={locale==='ru'?'Введите AGY':'Type AGY'} />}</section>}
    <section className={styles.grid}><label>{locale==='ru'?'Имя':'Display name'}<input value={name} onChange={event=>setName(event.target.value)} required/></label><label>{locale==='ru'?'Псевдоним':'Handle'}<input value={handle} onChange={event=>setHandle(event.target.value)} pattern="[a-z0-9][a-z0-9_-]*" required/></label><label className={styles.wide}>{locale==='ru'?'Корень рабочих пространств':'Workspace root'}<input value={state?.workspaceRoot??''} readOnly/></label><label className={styles.wide}>{locale==='ru'?'Первая комната':'First room'}<input value={roomTitle} onChange={event=>setRoomTitle(event.target.value)} required/></label></section>
    {error&&<p className={styles.error} role="alert">{error}</p>}<button className={styles.primary} disabled={busy}>{busy?(locale==='ru'?'Настраиваем…':'Setting up…'):(locale==='ru'?'Создать пространство':'Create workspace')}</button><p className={styles.note}>{locale==='ru'?'Можно продолжить без инструментов и подключить их позже.':'You can continue without a harness and connect one later.'}</p>
  </form></main>;
}

function Candidate({candidate,checked,onChange}:{candidate:SetupHarnessCandidate;checked:boolean;onChange:()=>void}){const available=candidate.safeToSelect;return <label className={`${styles.option} ${available?'':styles.unavailable}`}><input type="checkbox" checked={checked} disabled={!available} onChange={onChange}/><span><strong>{candidate.label}</strong><small>{candidate.endpoint?.reachable?'Endpoint ready':candidate.cli.found?`${candidate.cli.version??'CLI'} detected`:'Not detected'}</small></span></label>}
function instanceConfig(candidate:SetupHarnessCandidate):SetupHarnessInstance{return{id:`local-${candidate.type}`,type:candidate.type,enabled:true,...(candidate.endpoint?{endpoint:candidate.endpoint.url}:{}),...(candidate.type==='opencode'&&!candidate.endpoint?.reachable?{managed:true}:{}),...(candidate.type==='antigravity'?{permissionMode:'plan' as const}:{})};}
function message(value:unknown){return value instanceof Error?value.message:'Setup failed';}
