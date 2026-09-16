export type ProjectReference={projectId:string;projectName:string;root:string;path:string;kind:'file'|'directory';line?:number};
export const projectReferenceToken=(ref:ProjectReference)=>`⟦${ref.kind==='directory'?'📁':'📄'} ${ref.projectName.replace(/[⟦⟧\r\n]/g,' ')}: ${ref.path.replace(/[⟦⟧\r\n]/g,' ')}⟧`;
export const encodeProjectReference=(ref:ProjectReference)=>`[[project:${encodeURIComponent(JSON.stringify(ref))}]]`;
export function projectReferences(text:string){
  const result:Array<{start:number;end:number;reference:ProjectReference}>=[];
  for(const match of text.matchAll(/\[\[project:([^\]\r\n]{1,16000})\]\]/g)){
    try{
      const ref=JSON.parse(decodeURIComponent(match[1])) as ProjectReference;
      if(!ref||!['file','directory'].includes(ref.kind)||!['projectId','projectName','root','path'].every(key=>typeof ref[key as keyof ProjectReference]==='string'))continue;
      if(ref.line!==undefined&&(!Number.isSafeInteger(ref.line)||ref.line<1))continue;
      if(!ref.projectId||!ref.root||!ref.path||ref.path.startsWith('/')||ref.path.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'||part.includes(':'))||/[\x00-\x1f]/.test(ref.path))continue;
      result.push({start:match.index!,end:match.index!+match[0].length,reference:ref});
    }catch{/* Ordinary text remains ordinary text if a reference is malformed. */}
  }
  return result;
}
export function expandProjectReferences(text:string){
  let cursor=0,result='';
  for(const item of projectReferences(text)){
    const ref=item.reference,absolute=`${ref.root.replace(/[\\/]+$/,'')}/${ref.path}`;
    result+=text.slice(cursor,item.start)+`[Project ${ref.kind} reference: ${JSON.stringify(absolute)}; project: ${JSON.stringify(ref.projectName)}. Read current contents as needed; this is a path reference, not an attachment snapshot.]`;
    cursor=item.end;
  }
  return result+text.slice(cursor);
}
export function withoutProjectReferences(text:string){let result=text;for(const item of projectReferences(text).reverse())result=result.slice(0,item.start)+' '.repeat(item.end-item.start)+result.slice(item.end);return result;}
export function readableProjectReferences(text:string){let result=text;for(const item of projectReferences(text).reverse())result=result.slice(0,item.start)+projectReferenceToken(item.reference)+result.slice(item.end);return result;}
