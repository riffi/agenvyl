import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Bot, Check, ChevronDown, ChevronRight, Menu, Plus, Users } from 'lucide-react';
import type { HarnessCatalog, HarnessCatalogItem } from '../../entities/harness';
import type {PersonaGroup} from '../../entities/persona-group';
import { personaKeys, personasApi, type Persona } from '../../entities/persona';
import { roomsApi } from '../../entities/room';
import { Alert, Avatar, Button, Dialog, Input, Select, Spinner, TextArea } from '../../shared/ui';
import {PersonaCatalog} from './PersonaCatalog';
import styles from './PersonasScreen.module.css';
import {isPersonaDraftDirty,newPersonaDraft,personaHandleAfterNameChange,personaInputFromDraft,personaSaveAvailable,selectHarnessInstance,selectHarnessModel} from './personaDraft';

const PERSONA_COLORS=['#e0a33e','#62c98f','#5ba3f0','#c78bf0','#ef8fb0','#4fd0c3','#a7c957','#f0805a'];

function ModelPicker({models,value,onChange}:{models:HarnessCatalogItem[];value:string;onChange:(key:string)=>void}) {
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
  const selected=models.find(model=>model.id===value);
  return <div className={styles['model-field']}>
    <span>Модель</span>
    <div className={`${styles['model-picker']} ${open?styles.open:''}`}>
      <button ref={triggerRef} type="button" className={styles['model-picker-trigger']} aria-label="Выбрать модель" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(current=>!current)}>
        <span className={styles['model-picker-icon']}><Bot /></span>
        <span className={styles['model-picker-current']}>
          <strong>{selected?.label??selected?.id??(value||'Выберите модель')}</strong>
          <small>{selected ? <>ID <code>{selected.id}</code></> : value ? `Модель ${value} больше недоступна` : 'Модель выбранного harness'}</small>
        </span>
        <ChevronDown className={styles['model-picker-chevron']} aria-hidden="true" />
      </button>
      {open&&createPortal(<div ref={menuRef} className={styles['model-picker-menu']} role="listbox" aria-label="Доступные модели" style={{top:position.top,left:position.left,width:position.width,maxHeight:position.maxHeight}}>
        <header><strong>Доступные модели</strong><small>{models.length}</small></header>
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

export function HarnessRouteFields({form,catalog,error,onChange}:{form:Persona;catalog?:HarnessCatalog;error?:string;onChange:(next:Persona)=>void}) {
  const discovered=catalog?.instances??[];
  const selectedInstance=discovered.find(instance=>instance.id===form.harness_instance_id);
  const visibleInstances=form.harness_instance_id&&!selectedInstance?[...discovered,{id:form.harness_instance_id,type:form.harness_type,status:'unavailable' as const,capabilities:[],models:[],modes:[]}]:discovered;
  const visibleModels=selectedInstance?.models??(form.model_id?[{id:form.model_id,label:`${form.model_id} (сохранено)`}]:[]);
  const selectedModel=visibleModels.find(model=>model.id===form.model_id);
  const requiresExplicitMode=selectedInstance?.type==='antigravity';
  return <>
    {error&&<Alert tone="error">Каталог harness недоступен: {error}. Сохранённый выбор не изменён.</Alert>}
    <div className={styles['harness-grid']}>
      <label>Harness instance<Select aria-label="Harness instance" value={form.harness_instance_id} onChange={event=>{const instance=visibleInstances.find(item=>item.id===event.target.value);if(instance)onChange(selectHarnessInstance(form,instance))}}>{visibleInstances.length===0&&<option value="">Нет доступных instances</option>}{visibleInstances.map(instance=><option key={instance.id} value={instance.id} disabled={instance.status==='unavailable'}>{instance.id} · {instance.type}{instance.status==='healthy'?'':` · ${instance.status}`}</option>)}</Select></label>
      <ModelPicker models={visibleModels} value={form.model_id} onChange={modelId=>onChange(selectHarnessModel(form,modelId))}/>
      {selectedInstance&&selectedInstance.modes.length>0&&<label>Режим<Select aria-label="Режим harness" value={form.mode_id??''} onChange={event=>onChange({...form,mode_id:event.target.value||null})}>{requiresExplicitMode?(form.mode_id===null&&<option value="" disabled>Выберите режим</option>):<option value="">По умолчанию</option>}{selectedInstance.modes.map(mode=><option key={mode.id} value={mode.id}>{mode.label??mode.id}</option>)}</Select></label>}
    </div>
    {form.harness_instance_id&&<details className={styles['model-technical']}><summary>Технические параметры</summary><p><b>Instance:</b> {form.harness_instance_id} · <b>Type:</b> {form.harness_type}</p><p><b>Model:</b> {(selectedModel?.label??form.model_id)||'недоступна'}{form.mode_id&&<> · <b>Mode:</b> {form.mode_id}</>}</p></details>}
  </>;
}

export function PersonaInstructionFields({value,onChange}:{value:string;onChange:(value:string)=>void}){
  return <details className={`${styles['editor-section']} ${styles['instruction-section']}`} ui-spec-block-id="persona_behavior">
    <summary><span><strong>Инструкция персоны</strong><small>System prompt и правила поведения</small></span><ChevronDown aria-hidden="true"/></summary>
    <div className={styles['instruction-content']}><TextArea aria-label="Инструкция персоны" value={value} onChange={event=>onChange(event.target.value)}/><p className={styles['field-description']}>System prompt определяет поведение и область ответственности персоны.</p></div>
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
    if(!/^[a-z0-9][a-z0-9_-]*$/.test(handle)){setSaveError('Handle должен начинаться с буквы или цифры и содержать только a-z, 0-9, _ или -.');return false;}
    if (!form.name.trim()) {setSaveError('Укажите имя персоны.');return false;}
    const instance=harnessCatalog?.instances.find(item=>item.id===form.harness_instance_id);
    if (!instance || instance.status==='unavailable') {
      setSaveError('Выбранный harness сейчас недоступен. Обновите каталог или выберите другой instance.');
      return false;
    }
    if (!form.model_id || !instance.models.some(model=>model.id===form.model_id)) {
      setSaveError('Выберите доступную модель для выбранного harness.');
      return false;
    }
    if (form.mode_id && !instance.modes.some(mode=>mode.id===form.mode_id)) {
      setSaveError('Выбранный режим больше не поддерживается этим harness.');
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
    requestNavigation('созданию новой персоны',()=>{onSelectPersona('new');setSaveError(undefined);const empty=newPersonaDraft(harnessCatalog);setForm(empty);setSnapshot(empty)});
  };
  const requestNavigation=(label:string,action:()=>void)=>{if(!dirty){action();return}pendingNavigationRef.current=action;setPendingNavigation({label})};
  useEffect(()=>{registerNavigationGuard(requestNavigation);return()=>registerNavigationGuard(undefined)});
  const finishNavigation=()=>{const action=pendingNavigationRef.current;pendingNavigationRef.current=undefined;setPendingNavigation(undefined);setForm(snapshot);action?.()};
  useEffect(()=>{const previous=routeSelectionRef.current;if(selectedPersonaId===previous)return;if(dirty&&form&&(previous===(form.id||'new'))){onSelectPersona(previous,{replace:true});requestNavigation(`персоне «${personas.find(persona=>persona.id===selectedPersonaId)?.name??'выбранной ранее'}»`,()=>onSelectPersona(selectedPersonaId));return}routeSelectionRef.current=selectedPersonaId},[selectedPersonaId,dirty,form,onSelectPersona,personas]);
  const toggleMembership=async()=>{if(!form||!real)return;setSaving(true);setSaveError(undefined);const present=roomPersonaIds.has(form.id);try{await (present?roomsApi.removeParticipant(roomId,form.id):roomsApi.addParticipant(roomId,form.id));await onChanged();}catch(error){setSaveError(error instanceof Error?error.message:String(error));}finally{setSaving(false);}};
  const lifecycle = async (action:'archive'|'restore'|'delete') => {
    if(!form || !real)return;
    setSaving(true);setSaveError(undefined);
    try { await (action==='delete'?personasApi.remove(form.id):action==='archive'?personasApi.archive(form.id):personasApi.restore(form.id));onSelectPersona(undefined,{replace:true});setForm(undefined);setSnapshot(undefined);await onChanged(); }
    catch(e){setSaveError(e instanceof Error?e.message:String(e));}finally{setSaving(false);setLifecycleConfirmation(undefined)}
  };
  const requestLifecycle=(action:'archive'|'restore'|'delete')=>requestNavigation(action==='archive'?'архивированию персоны':action==='restore'?'восстановлению персоны':'удалению персоны',()=>setLifecycleConfirmation(action));
  const activePersonaCount=personas.filter(persona=>!persona.archived_at).length;
  const archivedPersonaCount=personas.length-activePersonaCount;
  const normalizedHandle=form?.handle.trim().replace(/^@/,'').toLowerCase()??'';
  const handleIssue=normalizedHandle&&!/^[a-z0-9][a-z0-9_-]*$/.test(normalizedHandle)
    ?'Только строчные латинские буквы, цифры, «_» и «-».'
    :normalizedHandle&&personas.some(persona=>persona.id!==form?.id&&persona.handle.toLowerCase()===normalizedHandle)
      ?`Handle @${normalizedHandle} уже занят другой персоной.`
      :undefined;
  return (
    <section className={styles['personas-screen']}>
      <header ui-spec-block-id="persona_catalog_header">
        <button type="button" className={styles['mobile-menu']} aria-label="Открыть меню" onClick={openMenu}><Menu /></button>
        <span className={styles['screen-title']}><strong><Users /> Персоны</strong><small>{activePersonaCount} активных · {archivedPersonaCount} в архиве</small></span>
        <Button type="button" variant="primary" className={styles['create-persona']} disabled={!real} onClick={startCreate}><Plus /><span>Новая персона</span></Button>
      </header>
      <div className={styles['personas-content']}>
        {loading && <div className={styles['loading-state']}><Spinner label="Загружаем персоны и модели…" /></div>}
        {error && <Alert tone="error">{error}</Alert>}
        {!loading && !error && (
          <>
            <div className={`${styles['catalog-column']} ${selectedPersonaId?styles['mobile-hidden']:''}`}>
              <PersonaCatalog personas={personas} groups={groups} selected={selected} creatingPersona={creating} roomPersonaIds={roomPersonaIds} real={real} onSelect={id=>requestNavigation(`персоне «${personas.find(persona=>persona.id===id)?.name??id}»`,()=>onSelectPersona(id))} onChanged={onChanged} onPersonaMoved={(id,group_id)=>{if(form?.id===id){setForm(current=>current?{...current,group_id}:current);setSnapshot(current=>current?{...current,group_id}:current)}}}/>
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
                <button type="button" className={styles['editor-back']} onClick={()=>requestNavigation('каталогу',()=>onSelectPersona())}>← Назад к каталогу</button>
                <header className={styles['persona-editor-header']} ui-spec-block-id="persona_editor_header">
                  <Avatar label={form.name||'Новая персона'} color={form.color}/>
                  <span><strong>{form.name||'Новая персона'}</strong><small>@{form.handle||'handle'} · {form.role||'роль не указана'}{form.group_id&&<> · {groups.find(group=>group.id===form.group_id)?.name}</>}</small></span>
                  <b className={dirty?styles['draft-dirty']:styles['draft-saved']}>{saving?'Сохраняем…':dirty?'Есть несохранённые изменения':'Сохранено'}</b>
                  <Button type="submit" variant="primary" disabled={!personaSaveAvailable({creating,dirty,real,saving})}>{creating?'Создать':'Сохранить'}</Button>
                </header>
                <section className={styles['editor-section']} ui-spec-block-id="persona_identity"><h3>Профиль</h3><div className={styles['profile-grid']}>
                  <label className={styles['validation-field']}>Имя<Input placeholder="Имя персоны" value={form.name} onChange={event=>setForm(current=>current?{...current,name:event.target.value,handle:personaHandleAfterNameChange(current.name,event.target.value,current.handle)}:current)}/><small className={styles['field-message']} aria-hidden="true" /></label>
                  <label className={styles['validation-field']}>Уникальный handle<span className={`${styles['handle-wrap']} ${handleIssue?styles.invalid:''}`}><b aria-hidden="true">@</b><Input aria-label="Handle персоны" placeholder="например, analyst" value={form.handle} onChange={e=>edit({handle:e.target.value.toLowerCase().replace(/^@/,'')})}/></span><small className={`${styles['field-message']} ${styles['handle-message']} ${handleIssue?styles.error:normalizedHandle?styles.available:''}`}>{handleIssue??(normalizedHandle?`@${normalizedHandle} — доступен`:'Используется в упоминаниях.')}</small></label>
                  <label>Роль<Input value={form.role} onChange={e=>edit({role:e.target.value})}/></label>
                  <label>Группа<Select value={form.group_id??''} onChange={e=>edit({group_id:e.target.value||null})}><option value="">Без группы</option>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>
                  <fieldset className={styles['color-swatches']}><legend>Устойчивый цвет персоны</legend><div>{[...new Set([...PERSONA_COLORS,form.color])].map(color=><label key={color} className={styles.swatch} style={{'--swatch-color':color} as CSSProperties}><input type="radio" name="persona-color" value={color} checked={form.color.toLowerCase()===color.toLowerCase()} onChange={()=>edit({color})}/><i aria-hidden="true"/></label>)}</div></fieldset>
                </div></section>
                <section className={styles['editor-section']} ui-spec-block-id="persona_harness_route"><h3>Среда запуска</h3>
                  <HarnessRouteFields form={form} catalog={harnessCatalog} error={harnessError} onChange={setForm}/>
                </section>
                <PersonaInstructionFields value={form.system_prompt??''} onChange={value=>edit({system_prompt:value})}/>
                {saveError&&<div className={styles['editor-alert']}><Alert tone="error">{saveError}</Alert></div>}
                {!creating&&real&&<><section className={styles['editor-section']} ui-spec-block-id="room_membership"><h3>Участие в комнате</h3><div className={styles['lifecycle-row']}><span><strong>{roomPersonaIds.has(form.id)?'Персона участвует в текущей комнате':'Персона не участвует в текущей комнате'}</strong><small>Это не меняет глобальные настройки персоны.</small></span>{!form.archived_at&&<Button type="button" variant="secondary" onClick={()=>void toggleMembership()} disabled={saving}>{roomPersonaIds.has(form.id)?'Убрать из комнаты':'Добавить в комнату'}</Button>}</div></section>
                <section className={styles['editor-section']} ui-spec-block-id="persona_lifecycle"><h3>Жизненный цикл</h3><div className={styles['lifecycle-row']}><span><strong>{form.archived_at?'Персона находится в архиве':'Персона активна'}</strong><small>{form.archived_at?'Её можно восстановить или удалить навсегда.':'Архивирование скроет её из активного каталога.'}</small></span>{form.archived_at?<><Button type="button" onClick={()=>requestLifecycle('restore')} disabled={saving}>Восстановить</Button><Button type="button" variant="danger" onClick={()=>requestLifecycle('delete')} disabled={saving}>Удалить навсегда…</Button></>:<Button type="button" onClick={()=>requestLifecycle('archive')} disabled={saving}>Архивировать</Button>}</div></section></>}
              </form>
            ) : selected ? <Spinner label="Загружаем детали…" /> : <div className={styles['editor-empty']} ui-spec-block-id="persona_catalog_empty_state"><div className={styles['qwen-empty-state']}><svg viewBox="0 0 130 70" aria-hidden="true"><path d="M24 50 65 18l41 32"/><path d="M24 50h82" strokeDasharray="3 4"/><circle cx="24" cy="50" r="8" className={styles['empty-node-gold']}/><circle cx="65" cy="18" r="8" className={styles['empty-node-blue']}/><circle cx="106" cy="50" r="8" className={styles['empty-node-green']}/></svg><h2>Персона не выбрана</h2><p>Откройте запись из каталога слева или создайте новую персону — она сразу станет доступна через @упоминание.</p><div><Button variant="primary" disabled={!real} onClick={startCreate}>Создать персону</Button>{personas.some(persona=>!persona.archived_at)&&<Button variant="secondary" onClick={()=>onSelectPersona(personas.find(persona=>!persona.archived_at)?.id)}>Открыть из каталога</Button>}</div></div></div>}
            </div>
          </>
        )}
      </div>
      <div ui-spec-block-id="unsaved_changes_guard"><Dialog open={Boolean(pendingNavigation)} title="Есть несохранённые изменения" description={`Вы изменили персону «${form?.name||form?.handle||'Новая персона'}». Что сделать перед переходом к ${pendingNavigation?.label??'другому экрану'}?`} onClose={()=>{pendingNavigationRef.current=undefined;setPendingNavigation(undefined)}} footer={<><Button onClick={()=>{pendingNavigationRef.current=undefined;setPendingNavigation(undefined)}}>Остаться</Button><Button variant="danger" onClick={finishNavigation}>Не сохранять и перейти</Button><Button variant="primary" disabled={saving} onClick={async()=>{if(await save())finishNavigation()}}>Сохранить и перейти</Button></>}><p>Несохранённые изменения будут потеряны, если продолжить без сохранения.</p></Dialog></div>
      <Dialog open={Boolean(lifecycleConfirmation)} title={lifecycleConfirmation==='delete'?'Удалить персону навсегда?':lifecycleConfirmation==='archive'?'Архивировать персону?':'Восстановить персону?'} description={lifecycleConfirmation==='delete'?'Это действие нельзя отменить.':undefined} onClose={()=>setLifecycleConfirmation(undefined)} footer={<><Button onClick={()=>setLifecycleConfirmation(undefined)}>Отмена</Button><Button variant={lifecycleConfirmation==='delete'?'danger':'primary'} disabled={saving} onClick={()=>lifecycleConfirmation&&void lifecycle(lifecycleConfirmation)}>{saving?'Выполняем…':lifecycleConfirmation==='delete'?'Удалить навсегда':lifecycleConfirmation==='archive'?'Архивировать':'Восстановить'}</Button></>}><p>{lifecycleConfirmation==='delete'?`@${form?.handle} будет окончательно удалена.`:lifecycleConfirmation==='archive'?'Персона исчезнет из активного каталога, но её можно будет восстановить.':'Персона снова появится в активном каталоге.'}</p></Dialog>
    </section>
  );
}
