import {describe,expect,it} from 'vitest';
import {buildClaudeCatalog,parseClaudeMode} from './mode-catalog.js';

describe('Claude catalog',()=>{
  it('builds model-specific permission and effort combinations',()=>{const catalog=buildClaudeCatalog([{value:'sonnet',displayName:'Sonnet',supportedEffortLevels:['low','high']},{value:'haiku',displayName:'Haiku'}]);expect(catalog.models[0]?.supportedModeIds).toEqual(['plan/low','plan/high','default/low','default/high','accept-edits/low','accept-edits/high']);expect(catalog.models[1]?.supportedModeIds).toEqual(['plan/default','default/default','accept-edits/default']);expect(parseClaudeMode('accept-edits/high')).toEqual({permissionMode:'acceptEdits',effort:'high'});});
  it('fails closed for invalid model metadata and modes',()=>{expect(()=>buildClaudeCatalog([{displayName:'missing id'}])).toThrow('models');expect(()=>parseClaudeMode('bypassPermissions/high')).toThrow();});
});
