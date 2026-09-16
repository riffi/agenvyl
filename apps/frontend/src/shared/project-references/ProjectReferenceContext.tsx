import {createContext,useContext} from 'react';
import type {ProjectReference} from '@agenvyl/contracts';
export const ProjectReferenceContext=createContext<{open:(reference:ProjectReference)=>void;insert:(reference:ProjectReference)=>void}|undefined>(undefined);
export const useProjectReferenceActions=()=>useContext(ProjectReferenceContext);
export function ProjectReferenceChip({reference}:{reference:ProjectReference}){
  const actions=useProjectReferenceActions();
  return <button type="button" disabled={!actions} title={`${reference.projectName}: ${reference.root}/${reference.path}`} onClick={()=>actions?.open(reference)} style={{display:'inline-flex',alignItems:'center',gap:4,border:'1px solid #ccd6e7',borderRadius:5,padding:'1px 6px',background:'#eff4fb',color:'#355583',font:'inherit',cursor:'pointer',maxWidth:'100%',overflowWrap:'anywhere'}}>{reference.kind==='directory'?'📁':'📄'} {reference.path}</button>;
}
