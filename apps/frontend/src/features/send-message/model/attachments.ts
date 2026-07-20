import {useCallback,useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import type {WorkspaceAttachment,WorkspaceEntry} from '@agenvyl/contracts';
import {roomsApi} from '../../../entities/room';

export const MAX_MESSAGE_ATTACHMENTS=10;

export type ComposerAttachment={
  id:string;name:string;size:number;mimeType:string;status:'uploading'|'ready'|'error';progress:number;
  attachment?:WorkspaceAttachment;file?:File;error?:string;
};

export function attachmentFromEntry(roomId:string,entry:WorkspaceEntry):WorkspaceAttachment|undefined{
  if(entry.kind!=='file'||entry.deleted_at||!entry.current_version_id)return undefined;
  const base=`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/versions/${encodeURIComponent(entry.current_version_id)}`;
  return {version_id:entry.current_version_id,entry_id:entry.id,name:entry.name,path:entry.path,size:entry.size,mime_type:entry.mime_type,url:base,preview_url:`${base}/preview`};
}

export function currentWorkspaceFiles(entries:WorkspaceEntry[]){return entries.filter(entry=>entry.kind==='file'&&!entry.deleted_at&&Boolean(entry.current_version_id)).sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at));}

function inboxName(file:File){
  if(file.name&&!/^(image|clipboard)(\.|$)/i.test(file.name))return file.name;
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const extension=file.type.split('/')[1]?.replace('jpeg','jpg')||'png';
  return `image-${stamp}.${extension}`;
}

export function useRoomAttachments(roomId:string){
  const queryClient=useQueryClient();
  const [items,setItems]=useState<ComposerAttachment[]>([]);
  const itemsRef=useRef(items);itemsRef.current=items;
  const controllers=useRef(new Map<string,AbortController>());
  const update=useCallback((id:string,change:Partial<ComposerAttachment>)=>setItems(current=>current.map(item=>item.id===id?{...item,...change}:item)),[]);
  useEffect(()=>{controllers.current.forEach(controller=>controller.abort());controllers.current.clear();setItems([])},[roomId]);
  const addExisting=useCallback((attachments:WorkspaceAttachment[])=>setItems(current=>{
    const versions=new Set(current.map(item=>item.attachment?.version_id).filter(Boolean));
    const next=[...current];
    for(const attachment of attachments){if(next.length>=MAX_MESSAGE_ATTACHMENTS)break;if(versions.has(attachment.version_id))continue;versions.add(attachment.version_id);next.push({id:attachment.version_id,name:attachment.name,size:attachment.size,mimeType:attachment.mime_type,status:'ready',progress:100,attachment})}
    return next;
  }),[]);
  const replaceReady=useCallback((attachments:WorkspaceAttachment[])=>setItems(current=>{
    const next=current.filter(item=>item.status!=='ready');
    for(const attachment of attachments){if(next.length>=MAX_MESSAGE_ATTACHMENTS)break;next.push({id:attachment.version_id,name:attachment.name,size:attachment.size,mimeType:attachment.mime_type,status:'ready',progress:100,attachment})}
    return next;
  }),[]);
  const runUpload=useCallback(async(item:ComposerAttachment)=>{
    if(!item.file)return;const controller=new AbortController();controllers.current.set(item.id,controller);update(item.id,{status:'uploading',progress:0,error:undefined});
    try{const result=await roomsApi.uploadFile(roomId,item.file,`Inbox/${inboxName(item.file)}`,'rename',{signal:controller.signal,onProgress:progress=>update(item.id,{progress})});if(!result.version)throw new Error('Сервер не вернул версию файла');const version=result.version;update(item.id,{status:'ready',progress:100,file:undefined,name:version.path.split('/').pop()??version.path,attachment:{version_id:version.id,entry_id:version.entry_id,path:version.path,name:version.path.split('/').pop()??version.path,size:version.size,mime_type:version.mime_type,url:version.url,preview_url:version.preview_url}});void queryClient.invalidateQueries({queryKey:['rooms',roomId,'workspace']})}
    catch(error){if(error instanceof DOMException&&error.name==='AbortError')return;update(item.id,{status:'error',error:error instanceof Error?error.message:String(error)})}finally{controllers.current.delete(item.id)}
  },[queryClient,roomId,update]);
  const uploadFiles=useCallback(async(files:File[])=>{
    const available=Math.max(0,MAX_MESSAGE_ATTACHMENTS-itemsRef.current.length);const pending=files.slice(0,available).map(file=>({id:crypto.randomUUID(),name:inboxName(file),size:file.size,mimeType:file.type||'application/octet-stream',status:'uploading' as const,progress:0,file}));
    if(!pending.length)return;setItems(current=>[...current,...pending]);let cursor=0;const worker=async()=>{while(cursor<pending.length){const item=pending[cursor++];await runUpload(item)}};await Promise.all(Array.from({length:Math.min(3,pending.length)},worker));
  },[runUpload]);
  const remove=useCallback((id:string)=>{controllers.current.get(id)?.abort();controllers.current.delete(id);setItems(current=>current.filter(item=>item.id!==id))},[]);
  const retry=useCallback((id:string)=>{const item=itemsRef.current.find(value=>value.id===id);if(item?.file)void runUpload(item)},[runUpload]);
  const clear=useCallback(()=>{controllers.current.forEach(controller=>controller.abort());controllers.current.clear();setItems([])},[]);
  return {items,ready:items.flatMap(item=>item.attachment?[item.attachment]:[]),busy:items.some(item=>item.status==='uploading'),addExisting,replaceReady,uploadFiles,remove,retry,clear};
}
