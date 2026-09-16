import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import type {ProjectBuild} from '@agenvyl/contracts';
import {projectError} from './project-files.js';
import {spawnStdioInWindowsJob} from './windows-job-object.js';

type Job={state:ProjectBuild;child:ChildProcess;timer:NodeJS.Timeout;closed:boolean;done:Promise<void>};
export class ProjectBuilds{
  private jobs=new Map<string,Job>();
  get(root:string){return this.jobs.get(root)?.state??null;}
  start(root:string,command:string){
    if(this.jobs.has(root)&&!this.jobs.get(root)!.closed)throw projectError('project_build_running','A build is already running for this project',409);
    if(!command.trim()||command.length>4000||command.includes('\0'))throw projectError('project_build_invalid','A build command is required');
    // The command is explicitly user-controlled. Pass the directory separately, never interpolate it into shell text.
    const child=process.platform==='win32'
      ?spawnStdioInWindowsJob({file:process.env.ComSpec??'cmd.exe',args:['/d','/s','/c',command],cwd:root},process.env)
      :spawn('/bin/sh',['-c',command],{cwd:root,env:process.env,detached:true,stdio:['ignore','pipe','pipe']});
    const state:ProjectBuild={id:randomUUID(),command,status:'running',log:'',started_at:new Date().toISOString()};
    const append=(chunk:string)=>{state.log=(state.log+chunk).slice(-128_000);};
    child.stdout?.setEncoding('utf8');child.stderr?.setEncoding('utf8');
    child.stdout?.on('data',append);child.stderr?.on('data',append);
    const timer=setTimeout(()=>{append('\nBuild exceeded the 10 minute limit.\n');this.cancel(root);},10*60_000);timer.unref();
    let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});
    const job:Job={state,child,timer,closed:false,done};this.jobs.set(root,job);
    child.once('error',error=>{append(error.message);state.status='failed';state.finished_at=new Date().toISOString();clearTimeout(timer);});
    child.once('close',code=>{clearTimeout(timer);if(state.status==='running')state.status=code===0?'completed':'failed';state.finished_at=new Date().toISOString();if(code!==null)state.exit_code=code;job.closed=true;finish();});
    // Keep only a bounded set of completed logs. Running jobs are never evicted.
    if(this.jobs.size>100)for(const[key,job]of this.jobs){if(job.closed){this.jobs.delete(key);break;}}
    return state;
  }
  cancel(root:string){
    const job=this.jobs.get(root);if(!job||job.state.status!=='running')return job?.state??null;
    job.state.status='cancelled';job.state.finished_at=new Date().toISOString();clearTimeout(job.timer);
    if(process.platform==='win32')job.child.kill();
    else if(job.child.pid){try{process.kill(-job.child.pid,'SIGKILL');}catch{job.child.kill('SIGKILL');}}
    return job.state;
  }
  async close(){for(const root of this.jobs.keys())this.cancel(root);await Promise.all([...this.jobs.values()].map(job=>job.done));}
}
