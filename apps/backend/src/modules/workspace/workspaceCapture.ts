import {createHash} from 'node:crypto';
import {open,lstat,readdir,rm,statfs,utimes,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {WorkspaceCaptureError} from '@agenvyl/contracts';
import type {SnapshotEntry} from './workspaceSnapshots.js';
import type {WorkspaceStatFingerprint} from './workspaceSlots.repository.js';

export type ScannedWorkspaceEntry={
  path:string;
  kind:'file'|'directory';
  stat?:WorkspaceFileStat;
};

export type WorkspaceFileStat={
  size:number;
  mtimeNs:string;
  ctimeNs:string;
  deviceId:string;
  fileId:string;
};

export type WorkspaceScan={
  entries:ScannedWorkspaceEntry[];
  errors:WorkspaceCaptureError[];
  scannedFiles:number;
};

export type WorkspaceContentManifest={
  manifest:string;
  errors:WorkspaceCaptureError[];
  files:number;
  bytes:number;
};

export const scanWorkspaceTree=async(root:string,maxBytes:number,prefix=''):Promise<WorkspaceScan>=>{
  const entries:ScannedWorkspaceEntry[]=[],errors:WorkspaceCaptureError[]=[];
  let scannedFiles=0;
  const directoryEntries=await readdir(path.join(root,prefix),{withFileTypes:true}).catch(()=>undefined);
  if(!directoryEntries)return{entries,errors:[{path:prefix,code:'read_failed'}],scannedFiles};
  for(const dirent of directoryEntries){
    const relative=prefix?`${prefix}/${dirent.name}`:dirent.name,target=path.join(root,...relative.split('/')),details=await lstat(target,{bigint:true}).catch(()=>undefined);
    if(!details){errors.push({path:relative,code:'read_failed'});continue}
    if(!prefix&&dirent.name==='.agenvyl'){errors.push({path:relative,code:'reserved'});continue}
    if(details.isSymbolicLink()){errors.push({path:relative,code:'symlink'});continue}
    if(details.isDirectory()){
      entries.push({path:relative,kind:'directory'});
      const nested=await scanWorkspaceTree(root,maxBytes,relative);
      entries.push(...nested.entries);errors.push(...nested.errors);scannedFiles+=nested.scannedFiles;
      continue;
    }
    if(!details.isFile())continue;
    scannedFiles++;
    if(details.size>BigInt(maxBytes)){errors.push({path:relative,code:'oversize'});continue}
    entries.push({path:relative,kind:'file',stat:toFileStat(details)});
  }
  entries.sort((left,right)=>left.path.localeCompare(right.path));
  errors.sort((left,right)=>left.path.localeCompare(right.path));
  return{entries,errors,scannedFiles};
};

export const stableReadWorkspaceFile=async(filePath:string)=>{
  for(let attempt=0;attempt<3;attempt++){
    const handle=await open(filePath,'r');
    try{
      const before=await handle.stat({bigint:true});
      if(!before.isFile())throw new Error('Workspace path is not a regular file');
      const data=await handle.readFile(),after=await handle.stat({bigint:true});
      if(sameFileStat(before,after))return{data,stat:toFileStat(after)};
    }finally{await handle.close()}
  }
  throw new Error('File changed while workspace snapshot was captured');
};

export const fingerprintMatches=(cached:WorkspaceStatFingerprint,current:WorkspaceFileStat,fenceMtimeNs?:string)=>{
  if(cached.size!==current.size||cached.mtimeNs!==current.mtimeNs||cached.ctimeNs!==current.ctimeNs||cached.deviceId!==current.deviceId||cached.fileId!==current.fileId)return false;
  if(!fenceMtimeNs)return false;
  const fence=BigInt(fenceMtimeNs);
  return BigInt(current.mtimeNs)<fence&&BigInt(current.ctimeNs)<fence;
};

export const exactEntriesEqual=(left:SnapshotEntry[],right:SnapshotEntry[])=>{
  if(left.length!==right.length)return false;
  const a=[...left].sort(byPath),b=[...right].sort(byPath);
  return a.every((entry,index)=>entry.path===b[index]?.path&&entry.kind===b[index]?.kind&&entry.versionId===b[index]?.versionId);
};

export const contentHash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');

export const workspaceContentManifest=async(root:string,maxBytes:number):Promise<WorkspaceContentManifest>=>{
  const scan=await scanWorkspaceTree(root,maxBytes),descriptors:string[]=[],errors=[...scan.errors];
  let files=0,bytes=0;
  for(const entry of scan.entries){
    if(entry.kind==='directory'){descriptors.push(`${entry.path}\x1fdirectory\x1f`);continue}
    const read=await stableReadWorkspaceFile(path.join(root,...entry.path.split('/'))).catch(()=>undefined);
    if(!read){errors.push({path:entry.path,code:'unstable'});continue}
    files++;bytes+=read.data.length;
    descriptors.push(`${entry.path}\x1ffile\x1f${contentHash(read.data)}`);
  }
  return{manifest:createHash('sha256').update(descriptors.sort().join('\n')).digest('hex'),errors,files,bytes};
};

export const probeStatCapability=async(slotRoot:string)=>{
  const probe=path.join(slotRoot,`.stat-probe-${crypto.randomUUID()}`);
  try{
    await writeFile(probe,'a',{flag:'wx'});
    const precise=new Date(1_700_000_000_123);
    await utimes(probe,precise,precise);
    const before=await lstat(probe,{bigint:true}),repeated=await lstat(probe,{bigint:true});
    await writeFile(probe,'b');
    await utimes(probe,precise,precise);
    const after=await lstat(probe,{bigint:true}),filesystem=await statfs(slotRoot,{bigint:true});
    const identityStable=sameFileStat(before,repeated);
    const subsecond=after.mtimeNs%1_000_000_000n!==0n;
    const detectsRewrite=after.ctimeNs!==before.ctimeNs||after.ino!==before.ino;
    const supported=identityStable&&subsecond&&detectsRewrite&&after.dev!==0n&&after.ino!==0n;
    return{supported,capabilityKey:`${after.dev}:${filesystem.type}:${identityStable?'stable':'unstable'}:${subsecond?'ns':'coarse'}:${detectsRewrite?'rewrite':'blind'}`};
  }catch{return{supported:false,capabilityKey:'unsupported'}}
  finally{await rm(probe,{force:true}).catch(()=>{})}
};

export const toStatFingerprint=(path:string,versionId:string,value:WorkspaceFileStat):WorkspaceStatFingerprint=>({
  path,versionId,size:value.size,mtimeNs:value.mtimeNs,ctimeNs:value.ctimeNs,deviceId:value.deviceId,fileId:value.fileId,
});

const toFileStat=(value:{size:bigint;mtimeNs:bigint;ctimeNs:bigint;dev:bigint;ino:bigint}):WorkspaceFileStat=>({
  size:Number(value.size),mtimeNs:value.mtimeNs.toString(),ctimeNs:value.ctimeNs.toString(),deviceId:value.dev.toString(),fileId:value.ino.toString(),
});

const sameFileStat=(left:{size:bigint;mtimeNs:bigint;ctimeNs:bigint;dev:bigint;ino:bigint},right:{size:bigint;mtimeNs:bigint;ctimeNs:bigint;dev:bigint;ino:bigint})=>
  left.size===right.size&&left.mtimeNs===right.mtimeNs&&left.ctimeNs===right.ctimeNs&&left.dev===right.dev&&left.ino===right.ino;

const byPath=(left:SnapshotEntry,right:SnapshotEntry)=>left.path.localeCompare(right.path);
