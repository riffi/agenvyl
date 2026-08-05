import {spawn,type ChildProcess} from 'node:child_process';

type Invocation={file:string;args:string[];windowsVerbatimArguments?:boolean};

export const spawnInWindowsJob=(invocation:Invocation,env:NodeJS.ProcessEnv,spawnProcess:typeof spawn=spawn)=>{
  const wrapper=spawnProcess('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encodedWrapper()],{
    env:{...env,AGENVYL_JOB_FILE:invocation.file,AGENVYL_JOB_ARGS:invocation.args.map(value=>Buffer.from(value,'utf8').toString('base64')).join('.'),AGENVYL_JOB_OWNER_PID:String(process.pid)},
    stdio:['ignore','pipe','ignore'],windowsHide:true,
  });
  return{child:wrapper,pid:readManagedPid(wrapper)};
};

const readManagedPid=(child:ChildProcess)=>new Promise<number>((resolve,reject)=>{
  let output='';
  const fail=()=>reject(new Error('Windows Job Object wrapper exited before assigning OpenCode'));
  child.once('exit',fail);
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data',(chunk:string)=>{
    output+=chunk;
    const match=output.match(/AGENvyl-PID:(\d+)/);
    if(!match)return;
    child.removeListener('exit',fail);
    resolve(Number(match[1]));
  });
});

let cached:string|undefined;
const encodedWrapper=()=>cached??=Buffer.from(wrapperSource,'utf16le').toString('base64');

const wrapperSource=String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$source=@'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class AgenvylJobRunner {
  const UInt32 KILL_ON_JOB_CLOSE=0x00002000;
  const UInt32 SYNCHRONIZE=0x00100000;
  const UInt32 INFINITE=0xFFFFFFFF;
  enum JobObjectInfoType { ExtendedLimitInformation=9 }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public UInt64 ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public Int64 PerProcessUserTimeLimit,PerJobUserTimeLimit;public UInt32 LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public UInt32 ActiveProcessLimit;public UIntPtr Affinity;public UInt32 PriorityClass,SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT BasicLimitInformation;public IO_COUNTERS IoInfo;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,JobObjectInfoType type,IntPtr info,uint length);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(UInt32 access,bool inherit,int pid);
  [DllImport("kernel32.dll")] static extern UInt32 WaitForMultipleObjects(UInt32 count,IntPtr[] handles,bool waitAll,UInt32 milliseconds);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  public static void Run(string file,string encodedArgs,int ownerPid){
    IntPtr job=CreateJobObject(IntPtr.Zero,null),owner=IntPtr.Zero,info=IntPtr.Zero;
    if(job==IntPtr.Zero)throw new Win32Exception();
    try{
      var limits=new EXTENDED_LIMIT();limits.BasicLimitInformation.LimitFlags=KILL_ON_JOB_CLOSE;
      int size=Marshal.SizeOf(typeof(EXTENDED_LIMIT));info=Marshal.AllocHGlobal(size);Marshal.StructureToPtr(limits,info,false);
      if(!SetInformationJobObject(job,JobObjectInfoType.ExtendedLimitInformation,info,(uint)size))throw new Win32Exception();
      var start=new ProcessStartInfo(file,JoinArguments(DecodeArguments(encodedArgs))){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden};
      start.EnvironmentVariables.Remove("AGENVYL_JOB_FILE");start.EnvironmentVariables.Remove("AGENVYL_JOB_ARGS");start.EnvironmentVariables.Remove("AGENVYL_JOB_OWNER_PID");
      var child=Process.Start(start);if(child==null)throw new InvalidOperationException("OpenCode did not start");
      if(!AssignProcessToJobObject(job,child.Handle)){child.Kill();throw new Win32Exception();}
      Console.WriteLine("AGENvyl-PID:"+child.Id);Console.Out.Flush();
      owner=OpenProcess(SYNCHRONIZE,false,ownerPid);if(owner==IntPtr.Zero)throw new Win32Exception();
      UInt32 wait=WaitForMultipleObjects(2,new[]{child.Handle,owner},false,INFINITE);if(wait==0xFFFFFFFF)throw new Win32Exception();
    }finally{
      if(owner!=IntPtr.Zero)CloseHandle(owner);if(info!=IntPtr.Zero)Marshal.FreeHGlobal(info);if(job!=IntPtr.Zero)CloseHandle(job);
    }
  }
  static string[] DecodeArguments(string value){if(String.IsNullOrEmpty(value))return new string[0];string[] encoded=value.Split('.'),result=new string[encoded.Length];for(int i=0;i<encoded.Length;i++)result[i]=Encoding.UTF8.GetString(Convert.FromBase64String(encoded[i]));return result;}
  static string JoinArguments(string[] args){var result=new StringBuilder();foreach(var arg in args){if(result.Length>0)result.Append(' ');result.Append(Quote(arg));}return result.ToString();}
  static string Quote(string value){if(value.Length>0&&value.IndexOfAny(new[]{' ','\t','"'})<0)return value;var result=new StringBuilder("\"");int slashes=0;foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){result.Append('\\',slashes*2+1);result.Append(c);slashes=0;continue;}result.Append('\\',slashes);slashes=0;result.Append(c);}result.Append('\\',slashes*2);return result.Append('"').ToString();}
}
'@
Add-Type -TypeDefinition $source -Language CSharp
[AgenvylJobRunner]::Run($env:AGENVYL_JOB_FILE,$env:AGENVYL_JOB_ARGS,[int]$env:AGENVYL_JOB_OWNER_PID)
`;
