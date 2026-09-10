import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat,readlink,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import type {WorkspaceRestoreChange} from '@agenvyl/contracts';
import {AppError} from '../../shared/errors/AppError.js';
import {TransparentGitWorkspace} from './TransparentGitWorkspace.js';
import type {RestoreOperation} from './WorkspaceRestoreRepository.js';

const execute=promisify(execFile);
const author=['-c','user.name=Agenvyl','-c','user.email=agenvyl@localhost'];
type TreeEntry={mode:string;hash:string};
export type RestoreSnapshot={head:string;tree:string;indexTree:string;branchRef:string;fingerprint:string;preservedPaths:string[]};

/** Git objects and a temporary index let previews include dirty files without changing HEAD or the live index. */
export class GitWorkspaceRestore {
  async assertHealthy(root:string){
    await new TransparentGitWorkspace().assertHealthy(root);
    const marker=await lstat(path.join(root,'.git'));
    if(!marker.isDirectory()||marker.isSymbolicLink())throw conflict('Workspace must have its own Git directory.');
    const top=(await git(root,['rev-parse','--show-toplevel'])).trim();
    if(await realpath(top)!==await realpath(root))throw conflict('Git root does not match this workspace.');
  }
  async hasCommit(root:string,head:string){return /^[a-f0-9]{40,64}$/.test(head)&&await git(root,['cat-file','-e',`${head}^{commit}`]).then(()=>true,()=>false);}
  async snapshot(root:string):Promise<RestoreSnapshot>{
    await this.assertHealthy(root);
    const head=(await git(root,['rev-parse','HEAD'])).trim();
    const branchRef=(await git(root,['symbolic-ref','-q','HEAD']).catch(()=>{throw conflict('Switch to a branch before restoring the workspace.')})).trim();
    const indexTree=(await git(root,['write-tree'])).trim();
    const temporary=path.join(root,'.git',`agenvyl-preview-${crypto.randomUUID()}.index`);
    let tree:string;
    try{
      await git(root,['read-tree',indexTree],temporary);
      await git(root,['add','-A','--','.'],temporary);
      tree=(await git(root,['write-tree'],temporary)).trim();
    }finally{await rm(temporary,{force:true});await rm(`${temporary}.lock`,{force:true});}
    const preservedPaths=(await git(root,['ls-files','--others','--ignored','--exclude-standard','-z'])).split('\0').filter(Boolean).sort();
    return{head,tree,indexTree,branchRef,preservedPaths,fingerprint:digest([head,tree,indexTree,branchRef,JSON.stringify(preservedPaths)])};
  }
  async changes(root:string,from:string,to:string):Promise<WorkspaceRestoreChange[]>{
    const fields=(await git(root,['diff','--no-renames','--name-status','-z',from,to,'--'])).split('\0').filter(Boolean);
    const result:WorkspaceRestoreChange[]=[];
    for(let i=0;i<fields.length;i+=2)result.push({path:fields[i+1]!,change:fields[i]==='A'?'created':fields[i]==='D'?'deleted':'updated'});
    return result;
  }
  async assertSafeTarget(root:string,current:string,target:string,recovering=false){
    if(!await this.hasCommit(root,target))throw conflict('The saved Git checkpoint is unavailable.');
    const before=await this.entries(root,current),after=await this.entries(root,target);
    const ignoreCase=process.platform==='win32'||(await git(root,['config','--bool','core.ignorecase']).catch(()=>'')).trim()==='true';
    const normalize=(name:string)=>ignoreCase?name.toLowerCase():name;
    const beforeNames=new Set([...before.keys()].map(normalize)),afterNames=[...after.keys()].map(normalize);
    if(new Set(afterNames).size!==afterNames.length)throw conflict('The target has paths that differ only in letter case.');
    const changes=await this.changes(root,current,target);
    if(changes.some(change=>change.path.split('/').some(segment=>['dist','build','out'].includes(segment.toLowerCase()))))throw conflict('Generated output is tracked in Git and differs from this checkpoint. This checkpoint cannot be restored without changing preserved output directories.');
    const touchedNames=[...afterNames,...changes.map(change=>normalize(change.path))];
    for(const [name,entry] of [...before,...after]){
      safePath(root,name);
      if(entry.mode==='160000')throw conflict('Workspace restoration does not support Git submodules.');
    }
    // Check all untracked paths, including ignored data. Never let Git overwrite them or a parent directory.
    const untracked=(await git(root,['ls-files','--others','-z'])).split('\0').filter(Boolean);
    for(const name of untracked){
      if(beforeNames.has(normalize(name)))continue;
      // Git can write new target files before atomically replacing the index.
      // Only exact target contents may bypass the collision guard during journal recovery.
      const targetName=[...after.keys()].find(candidate=>normalize(candidate)===normalize(name));
      if(recovering&&targetName&&await this.matchesTargetFile(root,name,after.get(targetName)!))continue;
      if(touchedNames.some(targetPath=>overlaps(normalize(name),targetPath)))throw conflict(`A preserved file conflicts with the target: ${name}`);
    }
    for(const name of after.keys()){
      const parts=name.split('/');
      for(let i=1;i<=parts.length;i++){
        const prefix=parts.slice(0,i).join('/'),entry=await lstat(safePath(root,prefix)).catch(()=>undefined);
        if(entry?.isSymbolicLink()&&!beforeNames.has(normalize(prefix))&&!(recovering&&i===parts.length&&await this.matchesTargetFile(root,prefix,after.get(name)!)))throw conflict(`A preserved link conflicts with the target: ${prefix}`);
        if(i===parts.length&&entry?.isDirectory()&&![...beforeNames].some(file=>file.startsWith(`${normalize(prefix)}/`)))throw conflict(`A preserved directory conflicts with the target: ${prefix}`);
      }
    }
  }
  async createCommits(root:string,snapshot:RestoreSnapshot,target:string,id:string){
    const originalTree=(await git(root,['rev-parse',`${snapshot.head}^{tree}`])).trim();
    const beforeHead=originalTree===snapshot.tree?snapshot.head:(await git(root,[...author,'commit-tree',snapshot.tree,'-p',snapshot.head,'-m',`agenvyl: checkpoint before restore ${id}`])).trim();
    const targetTree=(await git(root,['rev-parse',`${target}^{tree}`])).trim();
    const resultHead=(await git(root,[...author,'commit-tree',targetTree,'-p',beforeHead,'-m',`agenvyl: restore workspace ${id} to ${target}`])).trim();
    await git(root,['update-ref',`refs/agenvyl/restores/${id}/before`,beforeHead]);
    await git(root,['update-ref',`refs/agenvyl/restores/${id}/result`,resultHead]);
    return{beforeHead,resultHead};
  }
  async apply(root:string,operation:RestoreOperation){
    await this.assertHealthy(root);
    const snapshot=await this.snapshot(root);
    if(snapshot.branchRef!==operation.branchRef||![operation.originalHead,operation.beforeHead,operation.resultHead].includes(snapshot.head))throw conflict('Git history changed during restoration. Recovery requires the original branch.');
    await this.assertSafeTarget(root,operation.beforeHead,operation.resultHead,true);
    await this.assertRecoverableFiles(root,snapshot.tree,operation);
    if(snapshot.head===operation.resultHead){
      await this.assertApplied(root,snapshot,operation);
      return;
    }
    if(snapshot.head!==operation.beforeHead)await git(root,['update-ref',operation.branchRef,operation.beforeHead,operation.originalHead]);
    // The journal and retained commits exist before touching the live index or files.
    // Safety checks above reject preserved-path collisions and unexpected edits on recovery.
    await git(root,['read-tree',operation.beforeHead]);
    await git(root,['read-tree','--reset','-u',operation.resultHead]);
    await this.assertApplied(root,await this.snapshot(root),operation);
    await git(root,['update-ref',operation.branchRef,operation.resultHead,operation.beforeHead]);
  }
  private async assertRecoverableFiles(root:string,currentTree:string,operation:RestoreOperation){
    const before=await this.entries(root,operation.beforeHead),target=await this.entries(root,operation.resultHead),current=await this.entries(root,currentTree);
    const preserved=new Set(operation.preservedPaths??[]);
    for(const [name,entry] of current){
      if(preserved.has(name)&&!before.has(name)&&!target.has(name))continue;
      const original=before.get(name),restored=target.get(name);
      if(!same(entry,original)&&!same(entry,restored))throw conflict(`Files changed during restoration: ${name}. Recovery is paused to preserve them.`);
    }
    // A missing path is allowed: interrupted Git checkout may have removed it before writing its replacement.
  }
  private async assertApplied(root:string,snapshot:RestoreSnapshot,operation:RestoreOperation){
    const expected=(await git(root,['rev-parse',`${operation.resultHead}^{tree}`])).trim(),preserved=new Set(operation.preservedPaths??[]);
    // Restoring .gitignore may expose files that were ignored before checkout.
    // They remain untouched and untracked, even though the new ignore policy differs.
    const unexpected=(await this.changes(root,expected,snapshot.tree)).filter(change=>change.change!=='created'||!preserved.has(change.path));
    if(unexpected.length||snapshot.indexTree!==expected)throw conflict('Workspace files do not match the restored checkpoint. Recovery is paused.');
  }
  private async matchesTargetFile(root:string,name:string,target:TreeEntry){
    const file=safePath(root,name),details=await lstat(file).catch(()=>undefined);
    if(!details)return false;
    if(details.isSymbolicLink()&&target.mode==='120000'){
      const data=Buffer.from(await readlink(file));
      return createHash(target.hash.length===64?'sha256':'sha1').update(`blob ${data.length}\0`).update(data).digest('hex')===target.hash;
    }
    if(!details.isFile()||!target.mode.startsWith('100'))return false;
    return (await git(root,['hash-object',`--path=${name}`,'--',name])).trim()===target.hash;
  }
  private async entries(root:string,tree:string){
    const result=new Map<string,TreeEntry>();
    for(const item of (await git(root,['ls-tree','-r','-z',tree])).split('\0').filter(Boolean)){
      const tab=item.indexOf('\t'),[mode,,hash]=item.slice(0,tab).split(' ');
      result.set(item.slice(tab+1),{mode:mode!,hash:hash!});
    }
    return result;
  }
}

const git=async(root:string,args:string[],index?:string)=>{
  const result=await execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,env:{...process.env,...(index?{GIT_INDEX_FILE:index}:{})}});
  return result.stdout;
};
const digest=(values:string[])=>createHash('sha256').update(JSON.stringify(values)).digest('hex');
const same=(left:TreeEntry,right?:TreeEntry)=>left.hash===right?.hash&&left.mode===right?.mode;
const overlaps=(left:string,right:string)=>left===right||left.startsWith(`${right}/`)||right.startsWith(`${left}/`);
const conflict=(message:string)=>new AppError('workspace_restore_conflict',409,message);
const safePath=(root:string,name:string)=>{
  const segments=name.split('/'),target=path.resolve(root,...segments),relative=path.relative(path.resolve(root),target);
  if(!name||segments.some(part=>!part||part==='.'||part==='..'||['.git','.agenvyl','.versions'].includes(part.toLowerCase().replace(/[ .]+$/,''))||part.includes('\\')||(process.platform==='win32'&&part.includes(':')))||relative.startsWith('..')||path.isAbsolute(relative))throw conflict(`Unsupported workspace path: ${name}`);
  return target;
};
