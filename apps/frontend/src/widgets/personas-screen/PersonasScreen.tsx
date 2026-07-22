import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Bot, Check, ChevronDown, ChevronRight, Menu, Plus, Users } from 'lucide-react';
import {HarnessIcon,personaModelName,type HarnessCatalog,type HarnessCatalogItem,type HarnessInstance} from '../../entities/harness';
import type {PersonaGroup} from '../../entities/persona-group';
import { personaKeys, personasApi, type Persona } from '../../entities/persona';
import { roomsApi } from '../../entities/room';
import { Alert, Avatar, Button, Dialog, Input, Select, Spinner, TextArea } from '../../shared/ui';
import {PersonaCatalog} from './PersonaCatalog';
import styles from './PersonasScreen.module.css';
import {isPersonaDraftDirty,newPersonaDraft,personaHandleAfterNameChange,personaInputFromDraft,personaSaveAvailable,selectHarnessInstance,selectHarnessModel} from './personaDraft';

const PERSONA_COLORS=['#e0a33e','#62c98f','#5ba3f0','#c78bf0','#ef8fb0','#4fd0c3','#a7c957','#f0805a'];

const usePickerPopover=()=>{
  const triggerRef=useRef<HTMLButtonElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false);
  const [position,setPosition]=useState({top:0,left:0,width:0,maxHeight:390});
  useLayoutEffect(()=>{
    if(!open||!triggerRef.current)return;
    const update=()=>{
      const rect=triggerRef.current!.getBoundingClientRect();
      const mobile=window.innerWidth<=767;
      const width=mobile?window.innerWidth-20:rect.width;
      const left=mobile?10:Math.min(rect.left,window.innerWidth-width-8);
      const below=window.innerHeight-rect.bottom-8,above=rect.top-8;
      const maxHeight=Math.min(390,Math.max(180,below>=240?below:above));
      const top=below>=240?rect.bottom+7:Math.max(8,rect.top-maxHeight-7);
      setPosition({top,left,width,maxHeight});
    };
    update();
    window.addEventListener('resize',update);
    window.addEventListener('scroll',update,true);
    return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true)};
  },[open]);
  useEffect(()=>{
    const closeOnPointer=(event:PointerEvent)=>{const target=event.target as Node;if(!triggerRef.current?.contains(target)&&!menuRef.current?.contains(target))setOpen(false)};
    const closeOnEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);triggerRef.current?.focus()}};
    document.addEventListener('pointerdown',closeOnPointer);
    document.addEventListener('keydown',closeOnEscape);
    return()=>{document.removeEventListener('pointerdown',closeOnPointer);document.removeEventListener('keydown',closeOnEscape)};
  },[]);
  return{triggerRef,menuRef,open,setOpen,position};
};

function ModelPicker({models,value,onChange}:{models:HarnessCatalogItem[];value:string;onChange:(key:string)=>void}) {
  const {triggerRef,menuRef,open,setOpen,position}=usePickerPopover();
  const selected=models.find(model=>model.id===value);
  return <div className={styles['model-field']}>
    <span>Model</span>
    <div className={`${styles['model-picker']} ${open?styles.open:''}`}>
      <button ref={triggerRef} type="button" className={styles['model-picker-trigger']} aria-label="Select model" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(current=>!current)}>
        <span className={styles['model-picker-icon']}><Bot /></span>
        <span className={styles['model-picker-current']}>
          <strong>{selected?.label??selected?.id??(value||'Select a model')}</strong>
          <small>{selected ? <>ID <code>{selected.id}</code></> : value ? `Model ${value} is no longer available` : 'Model from the selected harness'}</small>
        </span>
        <ChevronDown className={styles['model-picker-chevron']} aria-hidden="true" />
      </button>
      {open&&createPortal(<div ref={menuRef} className={styles['model-picker-menu']} role="listbox" aria-label="Available models" style={{top:position.top,left:position.left,width:position.width,maxHeight:position.maxHeight}}>
        <header><strong>Available models</strong><small>{models.length}</small></header>
        <section>
          <div>
            {models.map(model=><button key={model.id} type="button" role="option" className={model.id===value?styles.selected:''} aria-selected={model.id===value} onClick={()=>{onChange(model.id);setOpen(false);triggerRef.current?.focus()}}>
              <span><strong>{model.label??model.id}</strong><small>ID <code>{model.id}</code></small></span>
              {model.id===value?<Check className={styles['model-picker-check']} aria-hidden="true"/>:<ChevronRight className={styles['model-picker-option-chevron']} aria-hidden="true"/>}
            </button>)}
          </div>
        </section>
      </div>,document.body)}
    </div>
  </div>;
}

function HarnessInstancePicker({instances,value,onChange}:{instances:HarnessInstance[];value:string;onChange:(instance:HarnessInstance)=>void}){
  const {triggerRef,menuRef,open,setOpen,position}=usePickerPopover();
  const selected=instances.find(instance=>instance.id===value);
  return <div className={styles['model-field']}>
    <span>Harness instance</span>
    <div className={`${styles['model-picker']} ${open?styles.open:''}`}>
      <button ref={triggerRef} type="button" className={styles['model-picker-trigger']} aria-label="Harness instance" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(current=>!current)}>
        <HarnessIcon type={selected?.type??''} size="md" className={styles['harness-picker-icon']}/>
        <span className={styles['model-picker-current']}><strong>{selected?.id??'No instances available'}</strong><small>{selected?`${selected.type}${selected.status==='healthy'?'':` · ${selected.status}`}`:'Connect a harness to continue'}</small></span>
        <ChevronDown className={styles['model-picker-chevron']} aria-hidden="true"/>
      </button>
      {open&&createPortal(<div ref={menuRef} className={styles['model-picker-menu']} role="listbox" aria-label="Available harness instances" style={{top:position.top,left:position.left,width:position.width,maxHeight:position.maxHeight}}>
        <header><strong>Available harnesses</strong><small>{instances.length}</small></header>
        <section><div>{instances.map(instance=><button key={instance.id} type="button" role="option" disabled={instance.status==='unavailable'} className={instance.id===value?styles.selected:''} aria-selected={instance.id===value} onClick={()=>{onChange(instance);setOpen(false);triggerRef.current?.focus()}}>
          <HarnessIcon type={instance.type}/><span><strong>{instance.id}</strong><small>{instance.type} · {instance.status}</small></span>
          {instance.id===value?<Check className={styles['model-picker-check']} aria-hidden="true"/>:<ChevronRight className={styles['model-picker-option-chevron']} aria-hidden="true"/>}
        </button>)}</div></section>
      </div>,document.body)}
    </div>
  </div>;
}

export function HarnessRouteFields({form,catalog,error,onChange}:{form:Persona;catalog?:HarnessCatalog;error?:string;onChange:(next:Persona)=>void}) {
  const discovered=catalog?.instances??[];
  const selectedInstance=discovered.find(instance=>instance.id===form.harness_instance_id);
  const visibleInstances=form.harness_instance_id&&!selectedInstance?[...discovered,{id:form.harness_instance_id,type:form.harness_type,status:'unavailable' as const,capabilities:[],models:[],modes:[]}]:discovered;
  const visibleModels=selectedInstance?.models??(form.model_id?[{id:form.model_id,label:`${form.model_id} (saved)`}]:[]);
  const selectedModel=visibleModels.find(model=>model.id===form.model_id);
  const visibleModes=selectedInstance?.modes.filter(mode=>!selectedModel?.supportedModeIds||selectedModel.supportedModeIds.includes(mode.id))??[];
  const requiresExplicitMode=selectedInstance?.type==='antigravity'||selectedInstance?.type==='claude';
  return <>
    {error&&<Alert tone="error">Harness catalog unavailable: {error}. The saved selection was not changed.</Alert>}
    <div className={styles['harness-grid']}>
      <HarnessInstancePicker instances={visibleInstances} value={form.harness_instance_id} onChange={instance=>onChange(selectHarnessInstance(form,instance))}/>
      <ModelPicker models={visibleModels} value={form.model_id} onChange={modelId=>onChange(selectHarnessModel(form,modelId,selectedInstance))}/>
      {selectedInstance&&visibleModes.length>0&&<label>Mode<Select aria-label="Harness mode" value={form.mode_id??''} onChange={event=>onChange({...form,mode_id:event.target.value||null})}>{requiresExplicitMode?(form.mode_id===null&&<option value="" disabled>Select a mode</option>):selectedInstance.type!=='codex'&&<option value="">Default</option>}{visibleModes.map(mode=><option key={mode.id} value={mode.id}>{mode.label??mode.id}</option>)}</Select></label>}
    </div>
    {form.harness_instance_id&&<details className={styles['model-technical']}><summary>Technical parameters</summary><p><b>Instance:</b> {form.harness_instance_id} · <b>Type:</b> {form.harness_type}</p><p><b>Model:</b> {(selectedModel?.label??form.model_id)||'unavailable'}{form.mode_id&&<> · <b>Mode:</b> {form.mode_id}</>}</p></details>}
  </>;
}

export function PersonaInstructionFields({value,onChange}:{value:string;onChange:(value:string)=>void}){
  return <details className={`${styles['editor-section']} ${styles['instruction-section']}`} ui-spec-block-id="persona_behavior">
    <summary><span><strong>Agent instructions</strong><small>System prompt and behavior rules</small></span><ChevronDown aria-hidden="true"/></summary>
    <div className={styles['instruction-content']}><TextArea aria-label="Agent instructions" value={value} onChange={event=>onChange(event.target.value)}/><p className={styles['field-description']}>The system prompt defines the agent’s behavior and responsibilities.</p></div>
  </details>;
}

export function PersonasScreen({
  personas,
  harnessCatalog,
  harnessError,
  groups,
  loading,
  error,
  onChanged,
  real,
  roomId,
  roomPersonaIds,
  selectedPersonaId,
  onSelectPersona,
  openMenu,
  registerNavigationGuard,
}: {
  personas: Persona[];
  harnessCatalog?: HarnessCatalog;
  harnessError?: string;
  groups:PersonaGroup[];
  loading: boolean;
  error?: string;
  onChanged: () => Promise<void>;
  real: boolean;
  roomId:string;
  roomPersonaIds:Set<string>;
  selectedPersonaId?:string;
  onSelectPersona:(id?:string,options?:{replace?:boolean})=>void;
  openMenu:()=>void;
  registerNavigationGuard:(guard:((label:string,action:()=>void)=>void)|undefined)=>void;
}) {
  const selected=selectedPersonaId==='new'?undefined:selectedPersonaId;
  const [form, setForm] = useState<Persona>();
  const [snapshot,setSnapshot]=useState<Persona>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const creating=selectedPersonaId==='new';
  const [pendingNavigation,setPendingNavigation]=useState<{label:string}|undefined>();
  const [lifecycleConfirmation,setLifecycleConfirmation]=useState<'archive'|'restore'|'delete'>();
  const pendingNavigationRef=useRef<(()=>void)|undefined>(undefined);
  const dirty=isPersonaDraftDirty(snapshot,form);
  const routeSelectionRef=useRef(selectedPersonaId);
  const selectedPersona = personas.find((persona) => persona.id === selected);
  const detailQuery = useQuery({
    queryKey: personaKeys.detail(selected ?? 'none'),
    queryFn: ({ signal }) => personasApi.detail(selected!, signal),
    enabled: real && !creating && Boolean(selectedPersona),
  });
  useEffect(() => {
    if (creating) return;
    const base = selectedPersona;
    if (!base) { setForm(undefined);setSnapshot(undefined); return; }
    if (!real) {
      setForm(base);setSnapshot(base);
      return;
    }
    if (detailQuery.data) { setForm(current=>dirty&&current?.id===base.id?current:detailQuery.data);setSnapshot(current=>dirty&&current?.id===base.id?current:detailQuery.data);setSaveError(undefined); }
    else { setForm(undefined);if(detailQuery.error)setSaveError(detailQuery.error instanceof Error?detailQuery.error.message:String(detailQuery.error)); }
  }, [selectedPersona, real, creating, detailQuery.data, detailQuery.error, dirty]);
  useEffect(()=>{if(creating&&form?.id!==""){const empty=newPersonaDraft(harnessCatalog);setForm(empty);setSnapshot(empty)}},[creating,form?.id,harnessCatalog]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue=''}};addEventListener('beforeunload',warn);return()=>removeEventListener('beforeunload',warn)},[dirty]);
  const edit=(patch:Partial<Persona>)=>setForm(current=>current?{...current,...patch}:current);
  const save = async ():Promise<boolean> => {
    if (!form || !real) return false;
    const handle=form.handle.trim().replace(/^@/,'').toLowerCase();
    if(!/^[a-z0-9][a-z0-9_-]*$/.test(handle)){setSaveError('Handle must start with a letter or digit and contain only a-z, 0-9, _, or -.');return false;}
    if (!form.name.trim()) {setSaveError('Enter an agent name.');return false;}
    const instance=harnessCatalog?.instances.find(item=>item.id===form.harness_instance_id);
    if (!instance || instance.status==='unavailable') {
      setSaveError('The selected harness is currently unavailable. Refresh the catalog or choose another instance.');
      return false;
    }
    if (!form.model_id || !instance.models.some(model=>model.id===form.model_id)) {
      setSaveError('Select an available model for the chosen harness.');
      return false;
    }
    const model=instance.models.find(model=>model.id===form.model_id);
    if (form.mode_id && (!instance.modes.some(mode=>mode.id===form.mode_id)||(model?.supportedModeIds&&!model.supportedModeIds.includes(form.mode_id)))) {
      setSaveError('The selected mode is no longer supported by this harness.');
      return false;
    }
    setSaving(true);
    setSaveError(undefined);
    try {
      const input=personaInputFromDraft({...form,handle});
      const saved = creating?await personasApi.create(input):await personasApi.update(form.id,input);
      setForm(saved);
      setSnapshot(saved);
      await onChanged();
      if(creating)onSelectPersona(saved.id,{replace:true});
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const startCreate = () => {
    requestNavigation('creating a new agent',()=>{onSelectPersona('new');setSaveError(undefined);const empty=newPersonaDraft(harnessCatalog);setForm(empty);setSnapshot(empty)});
  };
  const requestNavigation=(label:string,action:()=>void)=>{if(!dirty){action();return}pendingNavigationRef.current=action;setPendingNavigation({label})};
  useEffect(()=>{registerNavigationGuard(requestNavigation);return()=>registerNavigationGuard(undefined)});
  const finishNavigation=()=>{const action=pendingNavigationRef.current;pendingNavigationRef.current=undefined;setPendingNavigation(undefined);setForm(snapshot);action?.()};
  useEffect(()=>{const previous=routeSelectionRef.current;if(selectedPersonaId===previous)return;if(dirty&&form&&(previous===(form.id||'new'))){onSelectPersona(previous,{replace:true});requestNavigation(`agent “${personas.find(persona=>persona.id===selectedPersonaId)?.name??'previously selected'}”`,()=>onSelectPersona(selectedPersonaId));return}routeSelectionRef.current=selectedPersonaId},[selectedPersonaId,dirty,form,onSelectPersona,personas]);
  const toggleMembership=async()=>{if(!form||!real)return;setSaving(true);setSaveError(undefined);const present=roomPersonaIds.has(form.id);try{await (present?roomsApi.removeParticipant(roomId,form.id):roomsApi.addParticipant(roomId,form.id));await onChanged();}catch(error){setSaveError(error instanceof Error?error.message:String(error));}finally{setSaving(false);}};
  const lifecycle = async (action:'archive'|'restore'|'delete') => {
    if(!form || !real)return;
    setSaving(true);setSaveError(undefined);
    try { await (action==='delete'?personasApi.remove(form.id):action==='archive'?personasApi.archive(form.id):personasApi.restore(form.id));onSelectPersona(undefined,{replace:true});setForm(undefined);setSnapshot(undefined);await onChanged(); }
    catch(e){setSaveError(e instanceof Error?e.message:String(e));}finally{setSaving(false);setLifecycleConfirmation(undefined)}
  };
  const requestLifecycle=(action:'archive'|'restore'|'delete')=>requestNavigation(action==='archive'?'archiving the agent':action==='restore'?'restoring the agent':'deleting the agent',()=>setLifecycleConfirmation(action));
  const activePersonaCount=personas.filter(persona=>!persona.archived_at).length;
  const archivedPersonaCount=personas.length-activePersonaCount;
  const normalizedHandle=form?.handle.trim().replace(/^@/,'').toLowerCase()??'';
  const handleIssue=normalizedHandle&&!/^[a-z0-9][a-z0-9_-]*$/.test(normalizedHandle)
    ?'Use lowercase Latin letters, digits, “_”, and “-” only.'
    :normalizedHandle&&personas.some(persona=>persona.id!==form?.id&&persona.handle.toLowerCase()===normalizedHandle)
      ?`Handle @${normalizedHandle} is already used by another agent.`
      :undefined;
  return (
    <section className={styles['personas-screen']}>
      <header ui-spec-block-id="persona_catalog_header">
        <button type="button" className={styles['mobile-menu']} aria-label="Open menu" onClick={openMenu}><Menu /></button>
        <span className={styles['screen-title']}><strong><Users /> Agents</strong><small>{activePersonaCount} active · {archivedPersonaCount} archived</small></span>
        <Button type="button" variant="primary" className={styles['create-persona']} disabled={!real} onClick={startCreate}><Plus /><span>New agent</span></Button>
      </header>
      <div className={styles['personas-content']}>
        {loading && <div className={styles['loading-state']}><Spinner label="Loading agents and models…" /></div>}
        {error && <Alert tone="error">{error}</Alert>}
        {!loading && !error && (
          <>
            <div className={`${styles['catalog-column']} ${selectedPersonaId?styles['mobile-hidden']:''}`}>
              <PersonaCatalog personas={personas} catalog={harnessCatalog} groups={groups} selected={selected} creatingPersona={creating} roomPersonaIds={roomPersonaIds} real={real} onSelect={id=>requestNavigation(`agent “${personas.find(persona=>persona.id===id)?.name??id}”`,()=>onSelectPersona(id))} onChanged={onChanged} onPersonaMoved={(id,group_id)=>{if(form?.id===id){setForm(current=>current?{...current,group_id}:current);setSnapshot(current=>current?{...current,group_id}:current)}}}/>
            </div>
            <div className={`${styles['editor-panel']} ${!selectedPersonaId?styles['mobile-editor-hidden']:''}`} ui-spec-block-id="persona_editor_panel">
            {form ? (
              <form
                className={styles['persona-form']}
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <button type="button" className={styles['editor-back']} onClick={()=>requestNavigation('the catalog',()=>onSelectPersona())}>← Back to catalog</button>
                <header className={styles['persona-editor-header']} ui-spec-block-id="persona_editor_header">
                  <Avatar label={form.name||'New agent'} color={form.color}/>
                  <span><span className={styles['editor-name']}><strong>{form.name||'New agent'}</strong><HarnessIcon type={form.harness_type} size="md"/></span><small>@{form.handle||'handle'} · {personaModelName(form,harnessCatalog)}{form.group_id&&<> · {groups.find(group=>group.id===form.group_id)?.name}</>}</small></span>
                  <b className={dirty?styles['draft-dirty']:styles['draft-saved']}>{saving?'Saving…':dirty?'Unsaved changes':'Saved'}</b>
                  <Button type="submit" variant="primary" disabled={!personaSaveAvailable({creating,dirty,real,saving})}>{creating?'Create':'Save'}</Button>
                </header>
                <section className={styles['editor-section']} ui-spec-block-id="persona_identity"><h3>Profile</h3><div className={styles['profile-grid']}>
                  <label className={styles['validation-field']}>Name<Input placeholder="Agent name" value={form.name} onChange={event=>setForm(current=>current?{...current,name:event.target.value,handle:personaHandleAfterNameChange(current.name,event.target.value,current.handle)}:current)}/><small className={styles['field-message']} aria-hidden="true" /></label>
                  <label className={styles['validation-field']}>Unique handle<span className={`${styles['handle-wrap']} ${handleIssue?styles.invalid:''}`}><b aria-hidden="true">@</b><Input aria-label="Agent handle" placeholder="for example, analyst" value={form.handle} onChange={e=>edit({handle:e.target.value.toLowerCase().replace(/^@/,'')})}/></span><small className={`${styles['field-message']} ${styles['handle-message']} ${handleIssue?styles.error:normalizedHandle?styles.available:''}`}>{handleIssue??(normalizedHandle?`@${normalizedHandle} — available`:'Used in mentions.')}</small></label>
                  <label>Role<Input value={form.role} onChange={e=>edit({role:e.target.value})}/></label>
                  <label>Group<Select value={form.group_id??''} onChange={e=>edit({group_id:e.target.value||null})}><option value="">Ungrouped</option>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>
                  <fieldset className={styles['color-swatches']}><legend>Persistent agent color</legend><div>{[...new Set([...PERSONA_COLORS,form.color])].map(color=><label key={color} className={styles.swatch} style={{'--swatch-color':color} as CSSProperties}><input type="radio" name="persona-color" value={color} checked={form.color.toLowerCase()===color.toLowerCase()} onChange={()=>edit({color})}/><i aria-hidden="true"/></label>)}</div></fieldset>
                </div></section>
                <section className={styles['editor-section']} ui-spec-block-id="persona_harness_route"><h3>Runtime</h3>
                  <HarnessRouteFields form={form} catalog={harnessCatalog} error={harnessError} onChange={setForm}/>
                </section>
                <PersonaInstructionFields value={form.system_prompt??''} onChange={value=>edit({system_prompt:value})}/>
                {saveError&&<div className={styles['editor-alert']}><Alert tone="error">{saveError}</Alert></div>}
                {!creating&&real&&<><section className={styles['editor-section']} ui-spec-block-id="room_membership"><h3>Room membership</h3><div className={styles['lifecycle-row']}><span><strong>{roomPersonaIds.has(form.id)?'Agent is in the current room':'Agent is not in the current room'}</strong><small>This does not change the agent’s global settings.</small></span>{!form.archived_at&&<Button type="button" variant="secondary" onClick={()=>void toggleMembership()} disabled={saving}>{roomPersonaIds.has(form.id)?'Remove from room':'Add to room'}</Button>}</div></section>
                <section className={styles['editor-section']} ui-spec-block-id="persona_lifecycle"><h3>Lifecycle</h3><div className={styles['lifecycle-row']}><span><strong>{form.archived_at?'Agent is archived':'Agent is active'}</strong><small>{form.archived_at?'It can be restored or permanently deleted.':'Archiving hides it from the active catalog.'}</small></span>{form.archived_at?<><Button type="button" onClick={()=>requestLifecycle('restore')} disabled={saving}>Restore</Button><Button type="button" variant="danger" onClick={()=>requestLifecycle('delete')} disabled={saving}>Delete permanently…</Button></>:<Button type="button" onClick={()=>requestLifecycle('archive')} disabled={saving}>Archive</Button>}</div></section></>}
              </form>
            ) : selected ? <Spinner label="Loading details…" /> : <div className={styles['editor-empty']} ui-spec-block-id="persona_catalog_empty_state"><div className={styles['qwen-empty-state']}><svg viewBox="0 0 130 70" aria-hidden="true"><path d="M24 50 65 18l41 32"/><path d="M24 50h82" strokeDasharray="3 4"/><circle cx="24" cy="50" r="8" className={styles['empty-node-gold']}/><circle cx="65" cy="18" r="8" className={styles['empty-node-blue']}/><circle cx="106" cy="50" r="8" className={styles['empty-node-green']}/></svg><h2>No agent selected</h2><p>Open an agent from the catalog or create a new one. It will immediately become available through @mentions.</p><div><Button variant="primary" disabled={!real} onClick={startCreate}>Create agent</Button>{personas.some(persona=>!persona.archived_at)&&<Button variant="secondary" onClick={()=>onSelectPersona(personas.find(persona=>!persona.archived_at)?.id)}>Open from catalog</Button>}</div></div></div>}
            </div>
          </>
        )}
      </div>
      <div ui-spec-block-id="unsaved_changes_guard"><Dialog open={Boolean(pendingNavigation)} title="You have unsaved changes" description={`You changed agent “${form?.name||form?.handle||'New agent'}”. What should happen before navigating to ${pendingNavigation?.label??'another screen'}?`} onClose={()=>{pendingNavigationRef.current=undefined;setPendingNavigation(undefined)}} footer={<><Button onClick={()=>{pendingNavigationRef.current=undefined;setPendingNavigation(undefined)}}>Stay</Button><Button variant="danger" onClick={finishNavigation}>Discard and continue</Button><Button variant="primary" disabled={saving} onClick={async()=>{if(await save())finishNavigation()}}>Save and continue</Button></>}><p>Unsaved changes will be lost if you continue without saving.</p></Dialog></div>
      <Dialog open={Boolean(lifecycleConfirmation)} title={lifecycleConfirmation==='delete'?'Permanently delete agent?':lifecycleConfirmation==='archive'?'Archive agent?':'Restore agent?'} description={lifecycleConfirmation==='delete'?'This action cannot be undone.':undefined} onClose={()=>setLifecycleConfirmation(undefined)} footer={<><Button onClick={()=>setLifecycleConfirmation(undefined)}>Cancel</Button><Button variant={lifecycleConfirmation==='delete'?'danger':'primary'} disabled={saving} onClick={()=>lifecycleConfirmation&&void lifecycle(lifecycleConfirmation)}>{saving?'Working…':lifecycleConfirmation==='delete'?'Delete permanently':lifecycleConfirmation==='archive'?'Archive':'Restore'}</Button></>}><p>{lifecycleConfirmation==='delete'?`@${form?.handle} will be permanently deleted.`:lifecycleConfirmation==='archive'?'The agent will disappear from the active catalog but can be restored later.':'The agent will return to the active catalog.'}</p></Dialog>
    </section>
  );
}
