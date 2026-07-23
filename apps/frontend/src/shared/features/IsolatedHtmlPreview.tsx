import type {IframeHTMLAttributes} from 'react';
import {useRuntimeFeatures} from './RuntimeFeatures';

export const isolatedPreviewUrl=(previewUrl:string,previewOrigin:string)=>{
  if(!previewOrigin)return undefined;
  try{
    const source=new URL(previewUrl,window.location.origin);
    const target=new URL(`${source.pathname}${source.search}${source.hash}`,previewOrigin);
    return target.origin===window.location.origin?undefined:target.href;
  }catch{return undefined;}
};

export const IsolatedHtmlPreview=({previewUrl,...props}:{previewUrl:string}&Omit<IframeHTMLAttributes<HTMLIFrameElement>,'src'|'sandbox'>)=>{
  const{preview_origin:previewOrigin}=useRuntimeFeatures();
  const src=isolatedPreviewUrl(previewUrl,previewOrigin);
  if(!src)return <div role="status">Loading isolated preview…</div>;
  return <iframe {...props} src={src} sandbox="allow-scripts allow-same-origin"/>;
};
