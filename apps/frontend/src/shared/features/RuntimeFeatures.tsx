import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import type {RuntimeFeatures} from '@agenvyl/contracts';
import {apiRequest} from '../api';

const disabledFeatures:RuntimeFeatures={plan_mode:false,preview_origin:''};
const RuntimeFeaturesContext=createContext<RuntimeFeatures>(disabledFeatures);

export const RuntimeFeaturesProvider=({children,value}:{children:ReactNode;value?:RuntimeFeatures})=>{
  const[features,setFeatures]=useState<RuntimeFeatures>(value??disabledFeatures);
  useEffect(()=>{
    if(value)return;
    void apiRequest<RuntimeFeatures>('/api/v1/features').then(setFeatures).catch(()=>setFeatures(disabledFeatures));
  },[value]);
  return <RuntimeFeaturesContext.Provider value={features}>{children}</RuntimeFeaturesContext.Provider>;
};

export const useRuntimeFeatures=()=>useContext(RuntimeFeaturesContext);
