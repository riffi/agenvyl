import {expect,it} from 'vitest';
import {projectReferences,type ProjectReference} from '@agenvyl/contracts';
import {registerProjectReference,restoreProjectReferenceDraft,serializeProjectReferenceDraft} from './projectReferenceDraft';
it('keeps identical visible paths in different projects distinct through retries',()=>{
  const first:ProjectReference={projectId:'old',projectName:'Project',root:'/old',path:'src/main.ts',kind:'file'},second={...first,projectId:'new',root:'/new'};
  const registry=new Map<string,ProjectReference>();
  const a=registerProjectReference(registry,first),b=registerProjectReference(registry,second);
  expect(a).not.toBe(b);
  const wire=serializeProjectReferenceDraft(registry,`${a} and ${b}`);
  expect(projectReferences(wire).map(item=>item.reference.root)).toEqual(['/old','/new']);
  expect(serializeProjectReferenceDraft(registry,restoreProjectReferenceDraft(registry,wire))).toBe(wire);
});
