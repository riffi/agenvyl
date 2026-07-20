import {useEffect,useRef,useState} from 'react';
import {ChevronRight} from 'lucide-react';
import type {Persona} from '../../entities/persona';
import type {PersonaGroup} from '../../entities/persona-group';
import {Alert,Avatar,Button,Dialog,Input} from '../../shared/ui';
import styles from './RoomDialogs.module.css';

function GroupCheckbox({items,label,selected,onToggle}:{items:Persona[];label:string;selected:Set<string>;onToggle:()=>void}){const ref=useRef<HTMLInputElement>(null);const count=items.filter(item=>selected.has(item.id)).length;useEffect(()=>{if(ref.current)ref.current.indeterminate=count>0&&count<items.length},[count,items.length]);return <input ref={ref} type="checkbox" aria-label={`Выбрать всю группу «${label}»`} checked={Boolean(items.length)&&count===items.length} onChange={onToggle}/>}
function GroupedOptions({personas,groups,selected,onToggle}:{personas:Persona[];groups:PersonaGroup[];selected:Set<string>;onToggle:(id:string)=>void}){
  const sections=[...groups.map(group=>({id:group.id,name:group.name,items:personas.filter(p=>p.group_id===group.id)})),{id:'ungrouped',name:'Без группы',items:personas.filter(p=>!p.group_id)}].filter(section=>section.items.length);
  const [collapsed,setCollapsed]=useState(()=>new Set(sections.filter(section=>!section.items.some(persona=>selected.has(persona.id))).map(section=>section.id)));
  const toggleCollapsed=(id:string)=>setCollapsed(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next});
  return <>{sections.map(section=>{
    const all=section.items.every(persona=>selected.has(persona.id));
    const closed=collapsed.has(section.id);
    return <section className={styles.agentGroup} key={section.id}>
      <header>
        <GroupCheckbox items={section.items} label={section.name} selected={selected} onToggle={()=>section.items.forEach(persona=>{if(all?selected.has(persona.id):!selected.has(persona.id))onToggle(persona.id)})}/>
        <button type="button" className={styles.groupToggle} aria-expanded={!closed} onClick={()=>toggleCollapsed(section.id)}><ChevronRight className={closed?'':styles.expanded}/><strong>{section.name}</strong></button>
        <small>{section.items.filter(persona=>selected.has(persona.id)).length}/{section.items.length}</small>
      </header>
      {!closed&&[...section.items].sort((left,right)=>left.name.localeCompare(right.name)).map(persona=><label key={persona.id} className={selected.has(persona.id)?styles.selected:""}><input type="checkbox" checked={selected.has(persona.id)} onChange={()=>onToggle(persona.id)}/><Avatar label={persona.name} color={persona.color}/><span className={styles.agentIdentity}><strong>{persona.name}</strong><small>@{persona.handle} · {persona.role}</small></span></label>)}
    </section>;
  })}</>;
}
function toggleSet(current:Set<string>,id:string){const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next}

function AgentPicker({title,description,personas,groups,selected,onToggle,onClose,onSubmit,submitting,error,submitLabel}:{title:string;description:string;personas:Persona[];groups:PersonaGroup[];selected:Set<string>;onToggle:(id:string)=>void;onClose:()=>void;onSubmit:()=>void;submitting:boolean;error?:string;submitLabel:string}){return <div className={styles.root}><Dialog title={title} description={description} onClose={onClose} labelledBy="agent-picker-title" footer={<><small>Выбрано: {selected.size}</small><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={onSubmit} disabled={submitting}>{submitting?'Сохраняем…':submitLabel}</Button></>}><div className={styles.agentOptions}>{personas.length?<GroupedOptions personas={personas} groups={groups} selected={selected} onToggle={onToggle}/>:<p className="muted">Нет доступных агентов. Создайте их в разделе «Персоны».</p>}</div>{error&&<Alert className={styles.alert}>{error}</Alert>}</Dialog></div>}

export function CreateRoomDialog({personas,groups,onClose,onCreated}:{personas:Persona[];groups:PersonaGroup[];onClose:()=>void;onCreated:(title:string,personaIds:string[])=>Promise<void>}){const [title,setTitle]=useState('');const [selected,setSelected]=useState(()=>new Set<string>());const [saving,setSaving]=useState(false);const [error,setError]=useState<string>();const submit=async()=>{if(!title.trim()){setError('Укажите название комнаты.');return}setSaving(true);setError(undefined);try{await onCreated(title.trim(),[...selected]);onClose()}catch(e){setError(e instanceof Error?e.message:String(e));setSaving(false)}};return <div className={styles.root}><Dialog title="Новая комната" description="Назовите комнату и сразу подключите нужных агентов." onClose={onClose} labelledBy="create-room-title" footer={<><small>Выбрано: {selected.size}</small><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={()=>void submit()} disabled={saving}>{saving?'Создаём…':'Создать комнату'}</Button></>}><label className={styles.roomTitle}>Название<Input autoFocus value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void submit()}} placeholder="Например, Релиз 2.0"/></label><h3 className={styles.sectionTitle}>АГЕНТЫ КОМНАТЫ</h3><div className={`${styles.agentOptions} ${styles.roomAgents}`}><GroupedOptions personas={personas} groups={groups} selected={selected} onToggle={id=>setSelected(current=>toggleSet(current,id))}/></div>{error&&<Alert className={styles.alert}>{error}</Alert>}</Dialog></div>}

export function RoomAgentManager({personas,groups,roomPersonas,onClose,onSave}:{personas:Persona[];groups:PersonaGroup[];roomPersonas:Persona[];onClose:()=>void;onSave:(ids:Set<string>)=>Promise<void>}){const [selected,setSelected]=useState(()=>new Set(roomPersonas.map(persona=>persona.id)));const [saving,setSaving]=useState(false);const [error,setError]=useState<string>();const submit=async()=>{setSaving(true);setError(undefined);try{await onSave(selected);onClose()}catch(e){setError(e instanceof Error?e.message:String(e));setSaving(false)}};return <AgentPicker title="Агенты комнаты" description="Только подключённые агенты доступны для упоминаний и ответов в этой комнате." personas={personas} groups={groups} selected={selected} onToggle={id=>setSelected(current=>toggleSet(current,id))} onClose={onClose} onSubmit={()=>void submit()} submitting={saving} error={error} submitLabel="Сохранить состав"/>}
