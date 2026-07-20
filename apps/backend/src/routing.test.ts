import {describe,expect,it} from 'vitest';
import {parseMentions} from './routing.js';
describe('dynamic mention routing',()=>{it('uses the supplied room personas and expands all in order',()=>{expect(parseMentions('@ops @ALL @missing',['coder','ops'])).toEqual(['ops','coder'])});it('does not treat email fragments as mentions',()=>expect(parseMentions('mail a@ops.dev',['ops'])).toEqual([]));});
