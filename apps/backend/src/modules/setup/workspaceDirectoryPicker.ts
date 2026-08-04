import {execFile} from 'node:child_process';

type PickerRunner=(file:string,args:string[],env?:NodeJS.ProcessEnv)=>Promise<string>;

export async function pickWorkspaceDirectory(platform:NodeJS.Platform=process.platform,runner:PickerRunner=runPicker):Promise<string|undefined>{
  if(platform==='darwin')return selected(await runner('osascript',[
    '-e','try',
    '-e','POSIX path of (choose folder with prompt "Choose Agenvyl workspace root")',
    '-e','on error number -128',
    '-e','return ""',
    '-e','end try',
  ]));
  if(platform==='win32')return selected(await runner('powershell.exe',['-NoProfile','-STA','-NonInteractive','-Command',windowsPickerScript()]));
  if(platform==='linux')return linuxDirectory(runner);
  throw new Error(`Folder selection is not supported on ${platform}`);
}

async function linuxDirectory(runner:PickerRunner){
  try{return selected(await runner('zenity',['--file-selection','--directory','--title=Choose Agenvyl workspace root']));}
  catch(error){
    if(!missingCommand(error))return undefined;
    try{return selected(await runner('kdialog',['--getexistingdirectory','.','Choose Agenvyl workspace root']));}
    catch(fallbackError){if(!missingCommand(fallbackError))return undefined;throw new Error('Folder selection requires Zenity or KDialog');}
  }
}

function runPicker(file:string,args:string[],env?:NodeJS.ProcessEnv){
  return new Promise<string>((resolve,reject)=>execFile(file,args,{encoding:'utf8',windowsHide:true,timeout:5*60_000,env},(error,stdout)=>error?reject(error):resolve(stdout)));
}

function selected(value:string){const path=value.trim();return path||undefined;}
function missingCommand(error:unknown){return(error as NodeJS.ErrnoException)?.code==='ENOENT';}
function windowsPickerScript(){return`Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose Agenvyl workspace root'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.SelectedPath }
$dialog.Dispose()`;}
