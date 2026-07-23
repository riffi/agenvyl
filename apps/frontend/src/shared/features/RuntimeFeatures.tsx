import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import type {RuntimeFeatures} from '@agenvyl/contracts';
import {apiRequest} from '../api';

const disabledFeatures:RuntimeFeatures={plan_mode:false};
const RuntimeFeaturesContext=createContext<RuntimeFeatures>(disabledFeatures);

export const RuntimeFeaturesProvider=({children}:{children:ReactNode})=>{
  const[features,setFeatures]=useState<RuntimeFeatures>(disabledFeatures);
  useEffect(()=>{void apiRequest<RuntimeFeatures>('/api/v1/features').then(setFeatures).catch(()=>setFeatures(disabledFeatures));},[]);
  return <RuntimeFeaturesContext.Provider value={features}>{children}</RuntimeFeaturesContext.Provider>;
};

export const useRuntimeFeatures=()=>useContext(RuntimeFeaturesContext);
