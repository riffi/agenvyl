import {encodeProjectReference,projectReferenceToken,projectReferences,type ProjectReference} from '@agenvyl/contracts';
export type ProjectReferenceRegistry=Map<string,ProjectReference>;
export function registerProjectReference(registry:ProjectReferenceRegistry,reference:ProjectReference){
  const base=projectReferenceToken(reference);
  let token=base,index=2;
  while(registry.has(token)&&encodeProjectReference(registry.get(token)!)!==encodeProjectReference(reference))token=base.slice(0,-1)+` · ${index++}⟧`;
  registry.set(token,reference);
  return token;
}
export function serializeProjectReferenceDraft(registry:ProjectReferenceRegistry,value:string){
  for(const[token,reference]of registry)value=value.split(token).join(encodeProjectReference(reference));
  return value;
}
export function restoreProjectReferenceDraft(registry:ProjectReferenceRegistry,value:string){
  for(const item of projectReferences(value).reverse())value=value.slice(0,item.start)+registerProjectReference(registry,item.reference)+value.slice(item.end);
  return value;
}
