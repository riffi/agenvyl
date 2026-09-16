import {readdir,lstat} from 'node:fs/promises';
import mime from 'mime';
import type {ProjectDirectory} from '@agenvyl/contracts';
import {projectTarget} from './project-files.js';
export async function searchProject(root:string,query:string):Promise<ProjectDirectory>{
  await projectTarget(root,'',true);
  const needle=query.toLowerCase().replaceAll('\\','/'),queue=[''],found:ProjectDirectory['entries']=[];
  let count=0,truncated=false;
  while(queue.length&&count<10000&&found.length<30){
    const directory=queue.shift()!;
    const entries=await projectTarget(root,directory,true).then(target=>readdir(target,{withFileTypes:true})).catch(()=>[]);
    for(const entry of entries){
      if(++count>10000){truncated=true;break;}
      if(entry.isSymbolicLink()||['.git','node_modules','.cache','.next','.venv','venv'].includes(entry.name))continue;
      const relative=directory?`${directory}/${entry.name}`:entry.name;
      if((entry.isFile()||entry.isDirectory())&&relative.toLowerCase().includes(needle)){
        try{const info=await lstat(await projectTarget(root,relative));found.push({path:relative,name:entry.name,kind:entry.isDirectory()?'directory':'file',size:info.size,modified:info.mtime.toISOString(),mime_type:mime.getType(relative)??'application/octet-stream'});}catch{/* A concurrent move should not interrupt search. */}
        if(found.length>=30){truncated=true;break;}
      }
      if(needle&&entry.isDirectory()){if(relative.split('/').length<8)queue.push(relative);else truncated=true;}
    }
  }
  found.sort((a,b)=>a.kind===b.kind?a.path.localeCompare(b.path):a.kind==='directory'?-1:1);
  return{entries:found,truncated:truncated||queue.length>0};
}
