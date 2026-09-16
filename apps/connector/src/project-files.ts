import {open,readdir,realpath,lstat} from 'node:fs/promises';
import type {Dirent} from 'node:fs';
import path from 'node:path';
import mime from 'mime';
import {staticPreviewCandidates,type ProjectDirectory} from '@agenvyl/contracts';
import {WorkspacePolicyError} from './workspace-policy.js';

export const PROJECT_FILE_LIMIT=32*1024*1024;
const ignored=new Set(['.git','node_modules','.next','.cache','.venv','venv']);
export const projectError=(code:string,message:string,status=400)=>new WorkspacePolicyError(code,message,status);

export function projectRelative(input:string,allowRoot=false){
  if(allowRoot&&input==='')return '';
  const parts=input.replaceAll('\\','/').split('/');
  if(!input||parts.some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f:]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))||path.isAbsolute(input))throw projectError('project_path_invalid','A relative project path is required');
  if(parts.some(part=>part.toLowerCase()==='.git'))throw projectError('project_path_forbidden','Git internals are not available',403);
  return parts.join('/');
}

export async function projectTarget(root:string,input:string,allowRoot=false){
  const relative=projectRelative(input,allowRoot);
  let target=root;
  for(const part of relative?relative.split('/'):[]){
    target=path.join(target,part);
    const info=await lstat(target).catch(()=>{throw projectError('project_file_missing','Project file is unavailable',404);});
    if(info.isSymbolicLink())throw projectError('project_symlink','Symbolic links cannot be opened',403);
  }
  const canonical=await realpath(target),rel=path.relative(root,canonical);
  if(rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel))throw projectError('project_path_forbidden','File is outside the project',403);
  return canonical;
}

export async function listProject(root:string,directory=''):Promise<ProjectDirectory>{
  const target=await projectTarget(root,directory,true);
  const items=await readdir(target,{withFileTypes:true}).catch(()=>{throw projectError('project_directory_unavailable','Project directory is unavailable',404);});
  const visible=items.filter(item=>item.name!=='.git'&&!item.isSymbolicLink()&&(item.isFile()||item.isDirectory())).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name));
  const entries=await Promise.all(visible.slice(0,2000).map(async item=>{
    const relative=directory?`${directory}/${item.name}`:item.name;
    try{const target=await projectTarget(root,relative),info=await lstat(target);return{path:relative,name:item.name,kind:item.isDirectory()?'directory' as const:'file' as const,size:info.size,modified:info.mtime.toISOString(),mime_type:mime.getType(item.name)??'application/octet-stream'};}catch{return undefined;}
  }));
  return{entries:entries.filter(item=>item!==undefined),truncated:visible.length>2000};
}

export async function readProject(root:string,relative:string,limit=PROJECT_FILE_LIMIT){
  const target=await projectTarget(root,relative),handle=await open(target,'r');
  try{
    const before=await handle.stat(),resolved=await lstat(await projectTarget(root,relative));
    if(before.ino!==resolved.ino||before.dev!==resolved.dev)throw projectError('project_file_changed','File changed while being read; try again',409);
    if(!before.isFile())throw projectError('project_not_file','Select a file');
    if(before.size>limit)throw projectError('project_file_large',`File exceeds the ${Math.floor(limit/1024/1024)} MB preview limit`,413);
    const data=Buffer.alloc(before.size+1);let offset=0;
    while(offset<data.length){const result=await handle.read(data,offset,data.length-offset,offset);if(!result.bytesRead)break;offset+=result.bytesRead;}
    const after=await handle.stat();
    await projectTarget(root,relative);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||offset!==before.size)throw projectError('project_file_changed','File changed while being read; try again',409);
    return{data:data.subarray(0,offset),mime_type:mime.getType(relative)??'application/octet-stream'};
  }finally{await handle.close();}
}

export async function inspectProject(root:string){
  const paths:string[]=[],queue=[''];let scan_truncated=false,count=0;
  while(queue.length&&count<10000){
    const directory=queue.shift()!;
    let entries:Dirent[];
    try{entries=await readdir(await projectTarget(root,directory,true),{withFileTypes:true});}
    catch(error){if(!directory)throw error;scan_truncated=true;continue;}
    for(const entry of entries){
      if(++count>10000){scan_truncated=true;break;}
      const relative=directory?`${directory}/${entry.name}`:entry.name;
      if(entry.isFile())paths.push(relative);
      else if(entry.isDirectory()&&!ignored.has(entry.name)){if(relative.split('/').length<6)queue.push(relative);else scan_truncated=true;}
    }
  }
  scan_truncated ||= queue.length>0;
  let detected_command:string|null=null;
  if(paths.includes('package.json')){
    try{const file=await readProject(root,'package.json',1024*1024),pkg=JSON.parse(file.data.toString('utf8')) as {scripts?:{build?:unknown};packageManager?:string};
      if(typeof pkg.scripts?.build==='string'){
        const configured=typeof pkg.packageManager==='string'?pkg.packageManager.split('@')[0]:undefined;
        const manager=configured&&['npm','pnpm','yarn','bun'].includes(configured)?configured:paths.includes('pnpm-lock.yaml')?'pnpm':paths.includes('yarn.lock')?'yarn':paths.includes('bun.lockb')||paths.includes('bun.lock')?'bun':'npm';
        detected_command=`${manager} run build`;
      }
    }catch{/* A malformed package file does not prevent browsing files. */}
  }
  return{candidates:staticPreviewCandidates(paths),detected_command,scan_truncated};
}
