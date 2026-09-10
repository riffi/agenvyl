import {createHash} from 'node:crypto';
import path from 'node:path';
import {scanWorkspaceTree,stableReadWorkspaceFile} from './workspaceCapture.js';
import {directCaptureIgnoredDirectories} from './RunArtifactPolicy.js';
import {selectStaticPreviewPath} from './runStaticPreview.js';

export const previewOutputFingerprint=(entrypoint:string,files:{path:string;sha256:string}[])=>{
  const root=path.posix.dirname(entrypoint);
  return createHash('sha256').update(JSON.stringify([entrypoint,files.filter(file=>root==='.'||file.path.startsWith(`${root}/`)).map(file=>[file.path,file.sha256]).sort((a,b)=>a[0]!.localeCompare(b[0]!))])).digest('hex');
};

export const workspaceOutputFingerprint=async(root:string,maxFileBytes:number)=>{
  const scanned=await scanWorkspaceTree(root,maxFileBytes,'',directCaptureIgnoredDirectories);
  const entrypoint=selectStaticPreviewPath(scanned.entries.map(entry=>entry.path));
  if(!entrypoint)return 'none';
  const output=path.posix.dirname(entrypoint),files:{path:string;sha256:string}[]=[];
  if(scanned.errors.some(error=>error.code!=='reserved'&&(output==='.'||error.path.startsWith(`${output}/`))))throw new Error('Cannot fingerprint the existing build output. Resolve unreadable output before restoring.');
  for(const entry of scanned.entries){
    if(entry.kind==='directory'||(output!=='.'&&!entry.path.startsWith(`${output}/`)))continue;
    const read=await stableReadWorkspaceFile(path.join(root,...entry.path.split('/')));
    files.push({path:entry.path,sha256:createHash('sha256').update(read.data).digest('hex')});
  }
  return previewOutputFingerprint(entrypoint,files);
};
