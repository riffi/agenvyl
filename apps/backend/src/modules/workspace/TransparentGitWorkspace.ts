import {execFile} from 'node:child_process';
import {appendFile,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

const executeFile=promisify(execFile);
const authorArguments=['-c','user.name=Agenvyl','-c','user.email=agenvyl@localhost'];
const operationMarkers=['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','BISECT_LOG','rebase-apply','rebase-merge'];
const initialIgnore=['.agenvyl/','node_modules/','dist/','build/','out/','.cache/','coverage/','.env','.env.*','!.env.example',''];
const runtimeExcludes=['.chrome-render-profile/','.edge-render-profile/'];

export type GitCheckpoint={head:string;checkpointSha?:string};
export type GitChangedPath={path:string;change:'created'|'updated'|'deleted'};

export class TransparentGitWorkspace{
  async initialize(root:string){await this.ensureRepository(root)}
  currentHead(root:string){return this.head(root)}
  checkpoint(root:string,message:string){return this.commitDirty(root,message)}

  async changedPaths(root:string,baseHead:string,resultHead:string):Promise<GitChangedPath[]>{
    if(baseHead===resultHead)return[];
    const output=await git(root,['diff','--no-renames','--name-status','-z',baseHead,resultHead]),parts=output.split('\0').filter(Boolean),result:GitChangedPath[]=[];
    for(let index=0;index<parts.length;index+=2){const status=parts[index]!,filePath=parts[index+1];if(!filePath)continue;result.push({path:filePath.replace(/\\/g,'/'),change:status.startsWith('A')?'created':status.startsWith('D')?'deleted':'updated'});}
    return result;
  }

  async prepare(root:string,runId:string):Promise<GitCheckpoint>{
    const initialized=await this.ensureRepository(root);
    await this.assertHealthy(root);
    if(initialized)return{head:await this.head(root)};
    const checkpointSha=await this.commitDirty(root,`agenvyl: checkpoint before run ${runId}`);
    return{head:await this.head(root),...(checkpointSha?{checkpointSha}:{})};
  }

  async finalize(root:string,runId:string,status:'completed'|'failed'|'cancelled'):Promise<GitCheckpoint>{
    await this.assertHealthy(root);
    const checkpointSha=await this.commitDirty(root,`agenvyl: checkpoint ${status} run ${runId}`);
    return{head:await this.head(root),...(checkpointSha?{checkpointSha}:{})};
  }

  private async ensureRepository(root:string){
    await mkdir(root,{recursive:true});
    const marker=path.join(root,'.git'),markerExists=await exists(marker);
    if(markerExists){
      const details=await stat(marker);
      if(!details.isDirectory())throw new Error('Workspace .git must be a visible repository directory');
      await this.ensureRuntimeExcludes(root);
      return false;
    }
    await git(root,['init','-b','main']).catch(async()=>{await git(root,['init']);await git(root,['branch','-M','main'])});
    const ignorePath=path.join(root,'.gitignore');
    if(!await exists(ignorePath))await writeFile(ignorePath,initialIgnore.join('\n'));
    else if(!(await readFile(ignorePath,'utf8')).split(/\r?\n/).includes('.agenvyl/'))await appendFile(ignorePath,'\n.agenvyl/\n');
    await this.ensureRuntimeExcludes(root);
    await git(root,[...authorArguments,'add','-A']);
    await git(root,[...authorArguments,'commit','--allow-empty','-m','Initialize Agenvyl workspace']);
    return true;
  }

  private async assertHealthy(root:string){
    for(const marker of operationMarkers){
      const absolute=path.join(root,'.git',marker);
      if(await exists(absolute))throw new Error(`Workspace has an unfinished Git operation (${marker})`);
    }
  }

  private async ensureRuntimeExcludes(root:string){
    const excludePath=path.join(root,'.git','info','exclude');
    await mkdir(path.dirname(excludePath),{recursive:true});
    const existing=await readFile(excludePath,'utf8').catch(()=>''),lines=new Set(existing.split(/\r?\n/));
    const missing=runtimeExcludes.filter(pattern=>!lines.has(pattern));
    if(missing.length)await appendFile(excludePath,`${existing&&!existing.endsWith('\n')?'\n':''}${missing.join('\n')}\n`);
  }

  private async commitDirty(root:string,message:string){
    if(!(await git(root,['status','--porcelain=v1','-z'])).length)return undefined;
    await git(root,[...authorArguments,'add','-A']);
    await git(root,[...authorArguments,'commit','-m',message]);
    return this.head(root);
  }

  private head(root:string){return git(root,['rev-parse','HEAD']).then(value=>value.trim())}
}

const git=async(root:string,args:string[])=>{
  const result=await executeFile('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  return result.stdout;
};

const exists=(target:string)=>stat(target).then(()=>true).catch(()=>false);
