import {execFile} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import {isAbsolute,normalize,parse} from 'node:path';
import {promisify} from 'node:util';

const runFile=promisify(execFile);
const PICKER_TIMEOUT_MS=5*60_000;
const MAX_OUTPUT_BYTES=8_192;
type PickerRunner=(command:string,args:string[])=>Promise<{stdout:string}>;

export type DirectoryValidation={status:'available';path:string;pathKey:string}|{status:'unavailable';error:{code:string;message:string}};
export type DirectoryPicker={status:'selected';path:string}|{status:'cancelled'}|{status:'unavailable';error:{code:string;message:string}};

export const validateLocalDirectory=async(input:string):Promise<DirectoryValidation>=>{
  if(typeof input!=='string'||!input.trim()||!isAbsolute(input.trim()))return unavailable('directory_invalid','Project path must be absolute');
  try{
    const path=await realpath(input.trim());
    if(!(await stat(path)).isDirectory())return unavailable('directory_not_found','Project path must reference an existing directory');
    return{status:'available',path,pathKey:directoryPathKey(path)};
  }catch{return unavailable('directory_not_found','Project path must reference an existing directory');}
};

export const pickLocalDirectory=async(platform:NodeJS.Platform=process.platform,runner:PickerRunner=defaultRunner):Promise<DirectoryPicker>=>{
  if(platform==='win32')return runPicker('powershell.exe',['-NoProfile','-STA','-Command',windowsScript()],false,runner);
  if(platform==='darwin')return runPicker('/usr/bin/osascript',['-e','POSIX path of (choose folder with prompt "Choose a project folder")'],true,runner);
  if(platform==='linux'){
    const zenity=await runPicker('zenity',['--file-selection','--directory','--title=Choose a project folder'],true,runner);
    if(zenity.status!=='unavailable'||zenity.error.code!=='picker_missing')return zenity;
    return runPicker('kdialog',['--getexistingdirectory','.'],true,runner);
  }
  return{status:'unavailable',error:{code:'picker_unsupported',message:'A native folder picker is unavailable on this platform'}};
};

export const directoryPathKey=(path:string)=>{
  const normalized=normalize(path),root=parse(normalized).root;
  const cleaned=normalized.length>root.length?normalized.replace(/[\\/]+$/,''):normalized;
  return process.platform==='win32'?cleaned.toLocaleLowerCase('en-US'):cleaned;
};

const runPicker=async(command:string,args:string[],nonZeroIsCancel:boolean,runner:PickerRunner):Promise<DirectoryPicker>=>{
  try{
    const{stdout}=await runner(command,args);
    const selected=stdout.trim();
    if(!selected)return{status:'cancelled'};
    const validation=await validateLocalDirectory(selected);
    return validation.status==='available'?{status:'selected',path:validation.path}:validation;
  }catch(error){
    const issue=error as NodeJS.ErrnoException&{code?:string|number;killed?:boolean};
    if(issue.code==='ENOENT')return{status:'unavailable',error:{code:'picker_missing',message:'No supported desktop folder picker is installed'}};
    if(issue.killed)return{status:'unavailable',error:{code:'picker_timeout',message:'Folder selection timed out'}};
    if(nonZeroIsCancel)return{status:'cancelled'};
    return{status:'unavailable',error:{code:'picker_failed',message:'Folder selection failed'}};
  }
};

const defaultRunner:PickerRunner=async(command,args)=>runFile(command,args,{timeout:PICKER_TIMEOUT_MS,maxBuffer:MAX_OUTPUT_BYTES,windowsHide:true,encoding:'utf8'});

const unavailable=(code:string,message:string):DirectoryValidation=>({status:'unavailable',error:{code,message}});
const windowsScript=()=>`Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Choose a project folder'; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.SelectedPath }`;
