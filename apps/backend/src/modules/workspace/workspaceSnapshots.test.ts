import {describe,expect,it} from 'vitest';
import {diffSnapshots,manifestHash,mergeSnapshots,type SnapshotEntry} from './workspaceSnapshots.js';

const file=(path:string,versionId:string):SnapshotEntry=>({path,kind:'file',versionId});

describe('workspace snapshot manifests',()=>{
  it('hashes manifests independently of scan order',()=>{
    const directory:SnapshotEntry={path:'empty',kind:'directory'};
    expect(manifestHash([file('b','2'),directory,file('a','1')])).toBe(manifestHash([file('a','1'),file('b','2'),directory]));
    expect(manifestHash([directory])).not.toBe(manifestHash([]));
  });

  it('reports a final path diff',()=>{
    expect(diffSnapshots([file('old','1'),file('same','2')],[file('new','3'),file('same','2')])).toMatchObject([
      {path:'new',change:'created'},
      {path:'old',change:'deleted'},
    ]);
  });

  it('merges non-overlapping changes and preserves explicit conflicts',()=>{
    const base=[file('a','1'),file('b','1')],current=[file('a','2'),file('b','1')],candidate=[file('a','3'),file('b','2')];
    const result=mergeSnapshots(base,current,candidate);
    expect(result.entries).toEqual([file('a','2'),file('b','2')]);
    expect(result.conflicts).toEqual([{path:'a',base:{kind:'file',versionId:'1'},current:{kind:'file',versionId:'2'},candidate:{kind:'file',versionId:'3'}}]);
  });

  it.each([
    {name:'creates when current stayed at base',base:[],current:[],candidate:[file('x','2')],expected:[file('x','2')],conflicts:0},
    {name:'keeps an identical concurrent create',base:[],current:[file('x','2')],candidate:[file('x','2')],expected:[file('x','2')],conflicts:0},
    {name:'conflicts on different concurrent creates',base:[],current:[file('x','1')],candidate:[file('x','2')],expected:[file('x','1')],conflicts:1},
    {name:'deletes when current stayed at base',base:[file('x','1')],current:[file('x','1')],candidate:[],expected:[],conflicts:0},
    {name:'conflicts when candidate deletes a changed path',base:[file('x','1')],current:[file('x','2')],candidate:[],expected:[file('x','2')],conflicts:1},
    {name:'represents rename as delete and create',base:[file('old','1')],current:[file('old','1')],candidate:[file('new','1')],expected:[file('new','1')],conflicts:0},
  ])('$name',example=>{
    const result=mergeSnapshots(example.base,example.current,example.candidate);
    expect(result.entries).toEqual(example.expected);expect(result.conflicts).toHaveLength(example.conflicts);
  });
});
