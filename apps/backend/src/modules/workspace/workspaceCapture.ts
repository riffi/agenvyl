import {open,lstat,readdir} from 'node:fs/promises';
import path from 'node:path';
import type {WorkspaceCaptureError} from '@agenvyl/contracts';

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


export const scanWorkspaceTree=async(root:string,maxBytes:number,prefix='',ignoredDirectories:ReadonlySet<string>=new Set()):Promise<WorkspaceScan>=>{
  const entries:ScannedWorkspaceEntry[]=[],errors:WorkspaceCaptureError[]=[];
  let scannedFiles=0;
  const directoryEntries=await readdir(path.join(root,prefix),{withFileTypes:true}).catch(()=>undefined);
  if(!directoryEntries)return{entries,errors:[{path:prefix,code:'read_failed'}],scannedFiles};
  for(const dirent of directoryEntries){
    if(dirent.isDirectory()&&(dirent.name==='.git'||ignoredDirectories.has(dirent.name.toLowerCase())))continue;
    const relative=prefix?`${prefix}/${dirent.name}`:dirent.name,target=path.join(root,...relative.split('/')),details=await lstat(target,{bigint:true}).catch(()=>undefined);
    if(!details){errors.push({path:relative,code:'read_failed'});continue}
    if(!prefix&&dirent.name==='.agenvyl'){errors.push({path:relative,code:'reserved'});continue}
    if(details.isSymbolicLink()){errors.push({path:relative,code:'symlink'});continue}
    if(details.isDirectory()){
      entries.push({path:relative,kind:'directory'});
      const nested=await scanWorkspaceTree(root,maxBytes,relative,ignoredDirectories);
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


const toFileStat=(value:{size:bigint;mtimeNs:bigint;ctimeNs:bigint;dev:bigint;ino:bigint}):WorkspaceFileStat=>({
  size:Number(value.size),mtimeNs:value.mtimeNs.toString(),ctimeNs:value.ctimeNs.toString(),deviceId:value.dev.toString(),fileId:value.ino.toString(),
});

const sameFileStat=(left:{size:bigint;mtimeNs:bigint;ctimeNs:bigint;dev:bigint;ino:bigint},right:{size:bigint;mtimeNs:bigint;ctimeNs:bigint;dev:bigint;ino:bigint})=>
  left.size===right.size&&left.mtimeNs===right.mtimeNs&&left.ctimeNs===right.ctimeNs&&left.dev===right.dev&&left.ino===right.ino;
