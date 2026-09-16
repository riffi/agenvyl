import {describe,expect,it} from 'vitest';
import {encodeProjectReference,expandProjectReferences,projectReferences,readableProjectReferences,withoutProjectReferences,type ProjectReference} from './projectReferences.js';
const reference:ProjectReference={projectId:'project-1',projectName:'Игра',root:'C:\\work\\game',path:'src/my @coder file.ts',kind:'file'};
describe('project references',()=>{
  it('round trips unicode and spaces, preserving the original project root',()=>{
    const encoded=encodeProjectReference(reference),text=`Read ${encoded} please`;
    expect(projectReferences(text)).toEqual([{start:5,end:5+encoded.length,reference}]);
    expect(expandProjectReferences(text)).toContain('C:\\\\work\\\\game/src/my @coder file.ts');
    expect(readableProjectReferences(text)).toContain('Игра: src/my @coder file.ts');
    expect(withoutProjectReferences(text)).not.toContain('@coder');
    expect(withoutProjectReferences(text).length).toBe(text.length);
  });
  it('leaves malformed markers and unsafe relative paths as plain text',()=>{
    for(const path of ['../secret','/root','C:/secret','a//b','a/../b','a\\..\\b','file:stream']){
      const text=encodeProjectReference({...reference,path});
      expect(projectReferences(text)).toEqual([]);
      expect(expandProjectReferences(text)).toBe(text);
    }
    expect(projectReferences('[[project:%bad]]')).toEqual([]);
  });
  it('expands every reference without reading or embedding file contents',()=>{
    const text=`${encodeProjectReference(reference)} ${encodeProjectReference({...reference,kind:'directory',path:'src'})}`;
    expect(projectReferences(text)).toHaveLength(2);
    expect(expandProjectReferences(text)).toContain('Project directory reference');
    expect(expandProjectReferences(text)).not.toContain('[[project:');
  });
});
