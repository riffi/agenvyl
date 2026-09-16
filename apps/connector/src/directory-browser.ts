import {opendir,stat,realpath} from 'node:fs/promises';
import {homedir,hostname} from 'node:os';
import {isAbsolute,normalize,join,win32,posix} from 'node:path';
import type {DirectoryListing,DirectoryLocation} from '@agenvyl/contracts';

export const directoryRootCandidates=(platform:string,home:string):DirectoryLocation[]=>[
  {name:'Home',path:home},
  ...(platform==='win32'?Array.from({length:26},(_,i)=>({name:`${String.fromCharCode(65+i)}:`,path:`${String.fromCharCode(65+i)}:\\`})):[{name:'File system',path:'/'},...(platform==='darwin'?[{name:'Volumes',path:'/Volumes'}]:[])]),
];
export const directoryParent=(path:string,platform:string)=>{const api=platform==='win32'?win32:posix;const parent=api.dirname(path);return parent===path?null:parent;};
export async function browseDirectories(input?:string):Promise<DirectoryListing>{
  const common={home:homedir(),host:hostname(),platform:process.platform};
  if(!input){
    const candidates=directoryRootCandidates(process.platform,common.home);
    const available=await Promise.all(candidates.map(async entry=>{try{return(await stat(entry.path)).isDirectory()?entry:undefined;}catch{return undefined;}}));
    return{...common,path:null,parent:null,entries:available.filter((entry):entry is DirectoryLocation=>Boolean(entry)),truncated:false};
  }
  if(input.includes('\0')||!isAbsolute(input)||process.platform==='win32'&&['\\','/'].includes(win32.parse(input).root))throw new Error('Enter an absolute folder path.');
  // Resolve links on the Connector's OS. No workspace root is applied to this picker.
  const path=await realpath(normalize(input));
  const directory=await opendir(path),entries:DirectoryLocation[]=[];let truncated=false;
  for await(const entry of directory){
    const target=join(path,entry.name);
    let folder=entry.isDirectory();
    if(entry.isSymbolicLink()){try{folder=(await stat(target)).isDirectory();}catch{continue;}}
    if(!folder)continue;
    if(entries.length===2000){truncated=true;break;}
    entries.push({name:entry.name,path:target});
  }
  entries.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
  return{...common,path,parent:directoryParent(path,process.platform),entries,truncated};
}
export function directoryBrowseError(error:unknown){
  const code=(error as NodeJS.ErrnoException)?.code;
  return code==='EACCES'||code==='EPERM'?'Permission denied for this folder.':code==='ENOENT'?'Folder no longer exists.':code==='ENOTDIR'?'The path is not a folder.':code==='ELOOP'?'This symbolic link cannot be resolved.':error instanceof Error&&!code?error.message:'Could not read this folder. Check the path and connection.';
}
