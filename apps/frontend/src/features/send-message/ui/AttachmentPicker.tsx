import {useEffect,useMemo,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {File,FolderTree,History,Paperclip,Search,Upload} from 'lucide-react';
import type {WorkspaceAttachment} from '@agenvyl/contracts';
import {roomsApi} from '../../../entities/room';
import {Button,Dialog} from '../../../shared/ui';
import {attachmentFromEntry,currentWorkspaceFiles,MAX_MESSAGE_ATTACHMENTS} from '../model/attachments';
import styles from './AttachmentPicker.module.css';

export function AttachmentPicker({open,roomId,selected,onClose,onConfirm,onUpload}:{open:boolean;roomId:string;selected:WorkspaceAttachment[];onClose:()=>void;onConfirm:(items:WorkspaceAttachment[])=>void;onUpload:(files:File[])=>void}){
  const inputRef=useRef<HTMLInputElement>(null);const [tab,setTab]=useState<'recent'|'browse'>('recent');const [search,setSearch]=useState('');const [chosen,setChosen]=useState<Set<string>>(new Set());
  const query=useQuery({queryKey:['rooms',roomId,'workspace'],queryFn:({signal})=>roomsApi.workspace(roomId,signal),enabled:open&&Boolean(roomId)});
  useEffect(()=>{if(open){setChosen(new Set(selected.map(item=>item.version_id)));setSearch('');setTab('recent')}},[open,roomId]);
  const files=useMemo(()=>currentWorkspaceFiles(query.data?.entries??[]),[query.data]);
  const visible=useMemo(()=>{const normalized=search.trim().toLowerCase();const values=normalized?files.filter(item=>item.path.toLowerCase().includes(normalized)):files;return tab==='recent'?values.slice(0,12):values},[files,search,tab]);
  const toggle=(id:string)=>setChosen(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else if(next.size<MAX_MESSAGE_ATTACHMENTS)next.add(id);return next});
  const confirm=()=>{onConfirm(files.flatMap(entry=>chosen.has(entry.current_version_id??'')?[attachmentFromEntry(roomId,entry)!]:[]));onClose()};
  return <Dialog open={open} title="Прикрепить файлы" description="Загрузите новые файлы или выберите актуальные версии из workspace." onClose={onClose} footer={<><small>Выбрано {chosen.size} из {MAX_MESSAGE_ATTACHMENTS}</small><Button variant="secondary" onClick={onClose}>Отмена</Button><Button variant="primary" onClick={confirm}>Готово</Button></>}>
    <div className={styles.picker}>
      <input ref={inputRef} hidden type="file" multiple onChange={event=>{if(event.target.files?.length){onUpload([...event.target.files]);onClose()}event.currentTarget.value=''}}/>
      <Button className={styles.upload} variant="secondary" icon={<Upload/>} onClick={()=>inputRef.current?.click()}>Загрузить с устройства</Button>
      <label className={styles.search}><Search/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Поиск по имени или пути"/></label>
      <div className={styles.tabs}><button type="button" className={tab==='recent'?styles.active:''} onClick={()=>setTab('recent')}><History/>Недавние</button><button type="button" className={tab==='browse'?styles.active:''} onClick={()=>setTab('browse')}><FolderTree/>Все файлы</button></div>
      <div className={styles.list}>
        {query.isPending&&<p>Загружаем workspace…</p>}
        {query.isError&&<p>Не удалось загрузить workspace.</p>}
        {!query.isPending&&!visible.length&&<p>{search?'Ничего не найдено.':'В workspace пока нет файлов.'}</p>}
        {visible.map(entry=><label key={entry.id} className={chosen.has(entry.current_version_id!)?styles.chosen:''} style={tab==='browse'?{paddingLeft:8+Math.min(4,entry.path.split('/').length-1)*18}:undefined}><input type="checkbox" checked={chosen.has(entry.current_version_id!)} onChange={()=>toggle(entry.current_version_id!)}/><i><File/></i><span><strong>{entry.name}</strong><small>{entry.path} · {formatBytes(entry.size)}</small></span></label>)}
      </div>
      <button type="button" className={styles.workspaceHint} onClick={()=>setTab('browse')}><Paperclip/>Исторические версии доступны в полной панели workspace</button>
    </div>
  </Dialog>;
}

function formatBytes(value:number){if(value<1024)return`${value} Б`;if(value<1024*1024)return`${(value/1024).toFixed(1)} КБ`;return`${(value/1024/1024).toFixed(1)} МБ`;}
