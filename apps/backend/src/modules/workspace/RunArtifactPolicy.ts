import ignore, {type Ignore} from 'ignore';
import {diffSnapshots,entryMap,type SnapshotEntry} from './workspaceSnapshots.js';

export type RunArtifactVisibility='project'|'hidden';

const hiddenDirectories=new Set([
  '.agenvyl','.cache','.chrome-render-profile','.edge-render-profile','.git','.mypy_cache','.next','.npm','.nuxt','.parcel-cache','.playwright','.pnpm-store','.pytest_cache','.ruff_cache','.svelte-kit','.turbo','.venv',
  '__pycache__','build','coverage','dist','ms-playwright','node_modules','out','playwright-report','test-results','venv',
]);
const previewOutputDirectories=new Set(['build','dist','out']);

export const directCaptureIgnoredDirectories=new Set([...hiddenDirectories].filter(directory=>!previewOutputDirectories.has(directory)));

export class RunArtifactPolicy{
  private readonly matcher:Ignore;

  constructor(gitignore=''){
    this.matcher=ignore();
    if(gitignore.trim()){
      try{this.matcher.add(gitignore);}catch{
        // A malformed user file must not make snapshot capture or publication fail.
      }
    }
  }

  visibility(filePath:string,kind:'file'|'directory'='file'):RunArtifactVisibility{
    const normalized=normalizeArtifactPath(filePath);
    if(!normalized||hardHidden(normalized))return'hidden';
    if(this.matcher.ignores(normalized))return'hidden';
    if(kind==='directory'&&this.matcher.ignores(`${normalized}/`))return'hidden';
    return'project';
  }

  projectCandidate(base:SnapshotEntry[],result:SnapshotEntry[]):SnapshotEntry[]{
    const selected=entryMap(base),resultEntries=entryMap(result),projectFiles:string[]=[];
    const changes=diffSnapshots(base,result);
    for(const change of changes){
      const descriptor=change.next??change.prior;
      if(!descriptor||descriptor.kind!=='file'||this.visibility(change.path,descriptor.kind)!=='project')continue;
      if(change.next)selected.set(change.path,change.next);
      else selected.delete(change.path);
      if(change.next)projectFiles.push(change.path);
    }
    for(const filePath of projectFiles){
      const segments=filePath.split('/');
      for(let length=1;length<segments.length;length++){
        const parent=segments.slice(0,length).join('/'),descriptor=resultEntries.get(parent);
        if(descriptor?.kind==='directory')selected.set(parent,descriptor);
      }
    }
    for(const change of changes){
      if(change.next||change.prior?.kind!=='directory'||this.visibility(change.path,'directory')!=='project')continue;
      if(![...selected.keys()].some(candidate=>candidate.startsWith(`${change.path}/`)))selected.delete(change.path);
    }
    return[...selected].map(([path,value])=>({path,...value})).sort((left,right)=>left.path.localeCompare(right.path));
  }
}

const normalizeArtifactPath=(value:string)=>value.replaceAll('\\','/').replace(/^\.\/+/, '').replace(/\/{2,}/g,'/').replace(/\/$/,'');

const hardHidden=(filePath:string)=>{
  const segments=filePath.split('/').map(segment=>segment.toLowerCase());
  if(segments.some(segment=>hiddenDirectories.has(segment)))return true;
  if(segments.some((segment,index)=>segment==='.yarn'&&['cache','unplugged'].includes(segments[index+1]??'')))return true;
  const name=segments.at(-1)??'';
  if(name==='.ds_store'||name.endsWith('.tsbuildinfo'))return true;
  return/^\.env(?:\..+)?$/.test(name)&&name!=='.env.example';
};
