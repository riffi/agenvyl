const outputPriority=new Map([['dist',0],['build',1],['out',2]]);

export const selectStaticPreviewPath=(paths:string[])=>{
  const normalized=paths.map(value=>value.replaceAll('\\','/'));
  const builds=normalized.flatMap(filePath=>{
    const segments=filePath.split('/');
    if(segments.at(-1)?.toLowerCase()!=='index.html')return[];
    const output=segments.at(-2)?.toLowerCase();
    const priority=output?outputPriority.get(output):undefined;
    return priority===undefined?[]:[{filePath,priority,depth:segments.length}];
  }).sort((left,right)=>left.priority-right.priority||left.depth-right.depth||left.filePath.localeCompare(right.filePath));
  if(builds[0])return builds[0].filePath;
  if(normalized.includes('index.html')&&!normalized.includes('package.json'))return'index.html';
  return undefined;
};

export const hasUnbuiltWebProject=(paths:string[])=>paths.includes('package.json')&&paths.includes('index.html')&&!selectStaticPreviewPath(paths);
