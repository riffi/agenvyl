export type ComposerCommand={name:'new';label:string;description:string};
export type ComposerCommandMatch={command:ComposerCommand;start:number;end:number};
export type ActiveComposerCommandQuery={start:number;end:number;query:string};

export const composerCommands=[{name:'new',label:'Start fresh',description:'Start a new conversation with the selected agent.'}] as const satisfies readonly ComposerCommand[];

const commandByName=new Map<string,ComposerCommand>(composerCommands.map(command=>[command.name,command]));

const protectedCodeRanges=(text:string)=>{
  const ranges:Array<{start:number;end:number}>=[];
  for(const match of text.matchAll(/⟦[^⟧]*⟧/g))ranges.push({start:match.index!,end:match.index!+match[0].length});
  let index=0,fence:{marker:string;size:number;start:number}|undefined;
  while(index<text.length){
    const lineStart=index===0||text[index-1]==='\n';
    if(lineStart){
      const lineEnd=text.indexOf('\n',index),end=lineEnd===-1?text.length:lineEnd+1,line=text.slice(index,lineEnd===-1?text.length:lineEnd),match=line.match(/^ {0,3}(`{3,}|~{3,})/);
      if(match){
        const marker=match[1][0],size=match[1].length;
        if(!fence)fence={marker,size,start:index};
        else if(fence.marker===marker&&size>=fence.size){ranges.push({start:fence.start,end});fence=undefined;}
        index=end;continue;
      }
      if(fence){index=end;continue;}
      if(/^(?: {4,}|\t)/u.test(line)){ranges.push({start:index,end});index=end;continue;}
    }
    if(!fence&&text[index]==='`'){
      let size=1;while(text[index+size]==='`')size++;
      const marker='`'.repeat(size),end=text.indexOf(marker,index+size);
      if(end!==-1){ranges.push({start:index,end:end+size});index=end+size;continue;}
    }
    index++;
  }
  if(fence)ranges.push({start:fence.start,end:text.length});
  return ranges;
};

const isProtected=(index:number,ranges:ReadonlyArray<{start:number;end:number}>)=>ranges.some(range=>index>=range.start&&index<range.end);

export const findComposerCommands=(text:string):ComposerCommandMatch[]=>{
  const protectedRanges=protectedCodeRanges(text),matches:ComposerCommandMatch[]=[];
  for(const match of text.matchAll(/(^|\s)\/([a-z][a-z-]*)(?=$|\s)/giu)){
    const start=(match.index??0)+match[1].length,name=match[2].toLowerCase(),command=commandByName.get(name);
    if(!command||text[start-1]==='\\'||isProtected(start,protectedRanges))continue;
    matches.push({command,start,end:start+name.length+1});
  }
  return matches;
};

export const activeComposerCommandQuery=(text:string,caret:number):ActiveComposerCommandQuery|undefined=>{
  const before=text.slice(0,caret),match=before.match(/(^|\s)\/([a-z-]*)$/iu);
  if(!match)return;
  const start=caret-match[2].length-1;
  if(text[start-1]==='\\'||isProtected(start,protectedCodeRanges(text)))return;
  return{start,end:caret,query:match[2].toLowerCase()};
};

export const insertComposerCommandAt=(text:string,command:ComposerCommand,query:ActiveComposerCommandQuery)=>{
  const suffix=text.slice(query.end),separator=!suffix||/^\s/u.test(suffix)?'':' ';
  const next=`${text.slice(0,query.start)}/${command.name}${separator}${suffix}`,caret=query.start+command.name.length+1+separator.length;
  return{text:next,caret};
};

const mergeRanges=(ranges:Array<{start:number;end:number}>)=>{
  const merged:Array<{start:number;end:number}>=[];
  for(const range of ranges.sort((a,b)=>a.start-b.start)){
    const previous=merged.at(-1);
    if(previous&&range.start<=previous.end){previous.end=Math.max(previous.end,range.end);continue;}
    merged.push({...range});
  }
  return merged;
};

export const extractComposerCommands=(text:string)=>{
  const matches=findComposerCommands(text);
  if(!matches.length)return{text,commands:[] as ComposerCommand[]};
  const ranges=mergeRanges(matches.map(match=>{
    const lineStart=text.lastIndexOf('\n',match.start-1)+1,nextNewline=text.indexOf('\n',match.end),lineEnd=nextNewline===-1?text.length:nextNewline;
    const lineWithoutCommand=`${text.slice(lineStart,match.start)}${text.slice(match.end,lineEnd)}`;
    if(!lineWithoutCommand.trim())return{start:lineStart,end:nextNewline===-1?lineEnd:lineEnd+1};
    if(/[ \t]/u.test(text[match.end]??''))return{start:match.start,end:match.end+1};
    if(/[ \t]/u.test(text[match.start-1]??''))return{start:match.start-1,end:match.end};
    return{start:match.start,end:match.end};
  }));
  let output='',cursor=0;
  for(const range of ranges){output+=text.slice(cursor,range.start);cursor=range.end;}
  output+=text.slice(cursor);
  return{text:output,commands:[...new Map(matches.map(match=>[match.command.name,match.command])).values()]};
};
