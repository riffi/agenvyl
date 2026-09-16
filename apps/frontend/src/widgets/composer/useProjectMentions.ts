import {useEffect,useState} from 'react';
import type {ProjectFile,ProjectSummary} from '@agenvyl/contracts';
import {projectFilesApi} from '../../entities/project';
export function useProjectMentions(project:ProjectSummary|null|undefined,query:string|undefined,directory?:string){
  const[revision,setRevision]=useState(0);
  const[state,setState]=useState<{entries:ProjectFile[];loading:boolean;error?:string;truncated?:boolean}>({entries:[],loading:false});
  useEffect(()=>{
    if(!project||query===undefined){setState({entries:[],loading:false});return;}
    const controller=new AbortController();setState({entries:[],loading:true});
    const timer=setTimeout(()=>{void (directory===undefined?projectFilesApi.search(project.id,query,controller.signal):projectFilesApi.list(project.id,directory,controller.signal)).then(result=>{if(!controller.signal.aborted)setState({...result,entries:directory===undefined?result.entries:result.entries.filter(file=>file.name.toLowerCase().includes(query.toLowerCase())),loading:false});},error=>{if(!controller.signal.aborted)setState({entries:[],loading:false,error:error.message});});},180);
    return()=>{clearTimeout(timer);controller.abort();};
  },[project?.id,project?.path,query,directory,revision]);
  return {...state,retry:()=>setRevision(value=>value+1)};
}
