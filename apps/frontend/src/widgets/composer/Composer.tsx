import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileText, FolderOpen, LoaderCircle, Paperclip, RefreshCw, Send, Square, X } from 'lucide-react';
import type { Persona } from '../../entities/persona';
import { FakeRoomGateway, type DemoKind, type RoomGateway } from '../../features/room-session';
import { activeMentionQuery, insertMentionAt, parseMentions, removeMentionTarget, type ComposerAttachment } from '../../features/send-message';
import { ApiError } from '../../shared/api';
import { Alert, Button, TextArea } from '../../shared/ui';
import styles from './Composer.module.css';

function highlightMentions(text:string,personas:readonly Persona[]):ReactNode[] {
  const known=new Map(personas.map(persona=>[persona.handle.toLowerCase(),persona]));
  const parts:ReactNode[]=[];let cursor=0,index=0;
  for(const match of text.matchAll(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/giu)){
    const start=(match.index??0)+match[1].length,end=(match.index??0)+match[0].length,handle=match[2].toLowerCase();
    if(start>cursor)parts.push(text.slice(cursor,start));
    const persona=known.get(handle),color=handle==='all'?'#4f6ef7':persona?.color??'#b45309';
    parts.push(<mark key={`${start}-${index++}`} className={persona||handle==='all'?styles['known-mention']:styles['unknown-mention']} style={{color,backgroundColor:/^#[\da-f]{6}$/i.test(color)?`${color}1a`:undefined}}>{text.slice(start,end)}</mark>);
    cursor=end;
  }
  if(cursor<text.length)parts.push(text.slice(cursor));
  if(text.endsWith('\n'))parts.push('\u00a0');
  return parts;
}

export type ComposerHandle={insertMention:(handle:string)=>void};

export const Composer=forwardRef<ComposerHandle,ComposerProps>(function Composer({
  gateway,
  active,
  personas,
  catalogReady,
  onSent,
  openWorkspace,
  roomId,
  attachments,
  attachmentsBusy,
  openAttachmentPicker,
  uploadFiles,
  removeAttachment,
  retryAttachment,
  clearAttachments,
}: ComposerProps,ref) {
  const [text, setText] = useState("");
  const editorRef=useRef<HTMLTextAreaElement>(null);
  const mirrorRef=useRef<HTMLDivElement>(null);
  const mentionPopoverRef=useRef<HTMLDivElement>(null);
  const [mention,setMention]=useState<{start:number;end:number;query:string}>();
  const [mentionIndex,setMentionIndex]=useState(0);
  const [sending,setSending]=useState(false);
  const [sendError,setSendError]=useState<{message:string;messageId:string;text:string;targets:string[];attachmentVersionIds:string[]} | undefined>();
  useImperativeHandle(ref,()=>({insertMention:(handle:string)=>{const editor=editorRef.current,{text:next,caret}=insertMentionAt(text,handle,editor?.selectionStart??text.length,editor?.selectionEnd??text.length);if(next.length>4000)return;setText(next);setMention(undefined);requestAnimationFrame(()=>{editorRef.current?.focus();editorRef.current?.setSelectionRange(caret,caret)});}}),[text]);
  const targets = useMemo(
    () => parseMentions(text, personas),
    [text, personas],
  );
  const highlightedText=useMemo(()=>highlightMentions(text,personas),[text,personas]);
  const byHandle = new Map(personas.map((p) => [p.handle, p]));
  const mentionCandidates=useMemo(()=>[{handle:'all',name:'Все персоны',role:`Вызвать всех участников`,color:'#4f6ef7'},...personas].filter(persona=>!mention||!mention.query||persona.handle.toLowerCase().includes(mention.query)||persona.name.toLowerCase().includes(mention.query)||persona.role.toLowerCase().includes(mention.query)).slice(0,8),[mention,personas]);
  useEffect(()=>setMentionIndex(0),[mention?.query]);
  useEffect(()=>{setText('');setMention(undefined);setSendError(undefined)},[roomId]);
  useEffect(()=>{const editor=editorRef.current;if(!editor)return;editor.style.height='auto';editor.style.height=`${Math.min(Math.max(editor.scrollHeight,72),220)}px`;if(mirrorRef.current){mirrorRef.current.scrollTop=editor.scrollTop;mirrorRef.current.scrollLeft=editor.scrollLeft}},[text]);
  useLayoutEffect(()=>{if(!mention||!matchMedia('(max-width: 767px)').matches)return;const position=()=>{const popover=mentionPopoverRef.current,editor=editorRef.current;if(!popover||!editor)return;popover.style.setProperty('--mention-bottom',`${Math.max(0,window.innerHeight-editor.getBoundingClientRect().top)}px`)};position();window.visualViewport?.addEventListener('resize',position);addEventListener('resize',position);return()=>{window.visualViewport?.removeEventListener('resize',position);removeEventListener('resize',position)}},[mention,text,targets.length]);
  const updateMention=(value:string,caret:number)=>setMention(activeMentionQuery(value,caret));
  const chooseMention=(handle:string)=>{if(!mention)return;const next=`${text.slice(0,mention.start)}@${handle} ${text.slice(mention.end)}`,caret=mention.start+handle.length+2;setText(next);setMention(undefined);requestAnimationFrame(()=>{editorRef.current?.focus();editorRef.current?.setSelectionRange(caret,caret)});};
  const send = async (retry=sendError) => {
    const outgoing=retry?.text??text.trim(), outgoingTargets=retry?.targets??targets, messageId=retry?.messageId??crypto.randomUUID(),attachmentVersionIds=retry?.attachmentVersionIds??attachments.flatMap(item=>item.attachment?[item.attachment.version_id]:[]);
    if ((!outgoing&&!attachmentVersionIds.length) || !catalogReady || sending || (!retry&&attachmentsBusy))return;
    setSending(true);setSendError(undefined);
    try{await gateway.send(outgoing,outgoingTargets,messageId,attachmentVersionIds);setText("");setMention(undefined);clearAttachments();await onSent();}
    catch(error){setText(outgoing);setSendError({message:error instanceof ApiError?`${error.code}: ${error.message}`:error instanceof Error?error.message:String(error),messageId,text:outgoing,targets:outgoingTargets,attachmentVersionIds});}
    finally{setSending(false);}
  };
  return (
    <div className={styles.composer} ui-spec-block-id="room_composer">
      {gateway.mode === "fake" && (
        <div className={styles.demo}>
          <span>Демо-события · fake</span>
          {(
            [
              "parallel",
              "failure",
              "approval",
              "clarification",
              "reconnect",
            ] as DemoKind[]
          ).map((k) => (
            <Button
              key={k}
              size="sm"
              variant="secondary"
              onClick={() => (gateway as FakeRoomGateway).demo(k)}
            >
              {
                (
                  {
                    parallel: "Параллельно",
                    failure: "Ошибка",
                    approval: "Подтверждение",
                    clarification: "Уточнение",
                    reconnect: "Переподключение",
                  } as Record<DemoKind, string>
                )[k]
              }
            </Button>
          ))}
        </div>
      )}
      {active > 0 && <div className={styles['active-runs']}><span><i />{active} {active===1?'агент отвечает':active<5?'агента отвечают':'агентов отвечают'}</span><Button size="sm" variant="danger" onClick={() => void gateway.cancel()}><Square /> Остановить все</Button></div>}
      {sendError&&<Alert className={styles['send-error']} tone="error">Не удалось отправить: {sendError.message} <Button size="sm" variant="danger" onClick={()=>void send(sendError)} disabled={sending}>Повторить</Button></Alert>}
      <div className={styles['compose-card']}>
        {attachments.length>0&&<div className={styles.attachments}>{attachments.map(item=><span key={item.id} className={[item.status==='error'?styles['attachment-error']:'',item.mimeType.startsWith('image/')&&item.attachment?styles['image-attachment']:''].filter(Boolean).join(' ')}>{item.status==='uploading'?<LoaderCircle className={styles.spinning}/>:item.mimeType.startsWith('image/')&&item.attachment?<img src={item.attachment.preview_url} alt=""/>:<FileText/>}<button type="button" disabled={!item.attachment} onClick={()=>item.attachment&&window.open(item.attachment.preview_url,'_blank')}>{item.name}</button><small>{item.status==='uploading'?`${item.progress}%`:item.status==='error'?item.error:formatBytes(item.size)}</small>{item.status==='uploading'&&<i style={{width:`${item.progress}%`}}/>}{item.status==='error'&&<button type="button" aria-label={`Повторить загрузку ${item.name}`} onClick={()=>retryAttachment(item.id)}><RefreshCw/></button>}<button type="button" aria-label={`Убрать ${item.name}`} onClick={()=>removeAttachment(item.id)}><X/></button></span>)}</div>}
        {targets.length>0&&<div className={styles['target-row']}>
          <span>Ответят:</span>
          <div className={styles.targets}>
            {targets.map((h) => {
              const p = byHandle.get(h)!;
              return <button key={h} title={`Убрать @${h}`} onClick={() => setText(value=>removeMentionTarget(value,h,personas))}><i style={{ background: p.color }}>{p.name[0]}</i><span>{p.name}</span><X /></button>;
            })}
          </div>
        </div>}
        <div className={styles['editor-wrap']}>
          {mention&&mentionCandidates.length>0&&<div ref={mentionPopoverRef} className={styles['mention-popover']} role="listbox" aria-label="Выберите персону для упоминания">
            <header><span>Упомянуть</span><small>↑↓ выбор · Enter вставить</small></header>
            {mentionCandidates.map((candidate,index)=><button key={candidate.handle} type="button" role="option" aria-selected={index===mentionIndex} className={index===mentionIndex?styles.selected:''} onMouseDown={event=>event.preventDefault()} onClick={()=>chooseMention(candidate.handle)}>
              <i style={{background:candidate.color}}>{candidate.name[0]}</i><span><strong>{candidate.name}</strong><small><b>@{candidate.handle}</b><span> · {candidate.role}</span></small></span>{candidate.handle==='all'&&<em>все</em>}
            </button>)}
          </div>}
          <div ref={mirrorRef} className={styles['editor-mirror']} aria-hidden="true">{highlightedText}</div>
          <TextArea
            className={styles.editor}
            ref={editorRef}
            value={text}
            maxLength={4000}
            onChange={(e) => {setText(e.target.value);updateMention(e.target.value,e.target.selectionStart)}}
            onSelect={(e)=>updateMention(e.currentTarget.value,e.currentTarget.selectionStart)}
            onBlur={()=>setTimeout(()=>setMention(undefined),100)}
            onScroll={event=>{if(mirrorRef.current){mirrorRef.current.scrollTop=event.currentTarget.scrollTop;mirrorRef.current.scrollLeft=event.currentTarget.scrollLeft}}}
            onPaste={event=>{const files=[...event.clipboardData.items].filter(item=>item.kind==='file').flatMap(item=>{const file=item.getAsFile();return file?[file]:[]});if(files.length){event.preventDefault();uploadFiles(files)}}}
            onKeyDown={(e) => {
              if(mention&&mentionCandidates.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){
                e.preventDefault();setMentionIndex(index=>(index+(e.key==='ArrowDown'?1:-1)+mentionCandidates.length)%mentionCandidates.length);
              } else if(mention&&mentionCandidates.length&&(e.key==='Enter'||e.key==='Tab')){
                e.preventDefault();chooseMention(mentionCandidates[mentionIndex]?.handle??mentionCandidates[0].handle);
              } else if(mention&&e.key==='Escape'){
                e.preventDefault();setMention(undefined);
              } else if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){
                e.preventDefault();void send();
              }
            }}
            placeholder="Сообщение… Используйте @handle или @all"
          />
        </div>
        <footer>
        <div className={styles['compose-tools']}><Button className={styles['attachment-button']} size="sm" variant="ghost" title="Прикрепить файлы" aria-label="Прикрепить файлы" disabled={attachments.length>=10} onClick={openAttachmentPicker} icon={attachmentsBusy?<LoaderCircle className={styles.spinning}/>:<Paperclip/>}><span className={styles['action-label']}>Прикрепить</span></Button><Button className={styles['workspace-button']} size="sm" variant="ghost" title="Открыть workspace комнаты" aria-label="Открыть workspace комнаты" onClick={openWorkspace} icon={<FolderOpen />}><span className={styles['action-label']}>Workspace</span></Button></div>
        <small>{!catalogReady?'Каталог персон недоступен':`${text.length} / 4000`}</small>
        <Button
          className={styles.send}
          size="sm"
          variant="primary"
          aria-label={sending?'Отправляем сообщение':'Отправить сообщение'}
          disabled={(!text.trim()&&!attachments.some(item=>item.status==='ready')) || !catalogReady || sending || attachmentsBusy}
          onClick={()=>void send()}
        >
          {sending?<><LoaderCircle className={styles.spinning}/><span className={styles['action-label']}>Отправляем…</span></>:<><span className={styles['action-label']}>Отправить</span><Send /></>}
        </Button>
        </footer>
      </div>
    </div>
  );
});

type ComposerProps={
  gateway: RoomGateway;
  active: number;
  personas: Persona[];
  catalogReady: boolean;
  onSent:()=>Promise<void>;
  openWorkspace:()=>void;
  roomId:string;
  attachments:ComposerAttachment[];
  attachmentsBusy:boolean;
  openAttachmentPicker:()=>void;
  uploadFiles:(files:File[])=>void;
  removeAttachment:(id:string)=>void;
  retryAttachment:(id:string)=>void;
  clearAttachments:()=>void;
};

function formatBytes(value:number){if(value<1024)return`${value} Б`;if(value<1024*1024)return`${(value/1024).toFixed(1)} КБ`;return`${(value/1024/1024).toFixed(1)} МБ`;}
