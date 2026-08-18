import {describe,expect,it} from 'vitest';
import {activeComposerCommandQuery,extractComposerCommands,findComposerCommands,insertComposerCommandAt,composerCommands} from './composerCommands';

describe('composer commands',()=>{
  it.each([
    ['/new Review this','Review this'],
    ['Please /new review this','Please review this'],
    ['Review this /new','Review this'],
    ['Before\n/new\nAfter','Before\nAfter'],
    ['/new /new Review','Review'],
  ])('extracts /new from %j', (input,output)=>expect(extractComposerCommands(input)).toEqual({text:output,commands:[composerCommands[0]]}));

  it.each(['Use /newton','https://example.test/new','Use \\/new literally','Use `/new` literally','```text\n/new\n```','    /new in indented code'])('does not treat %j as a command',input=>{
    expect(findComposerCommands(input)).toEqual([]);
    expect(extractComposerCommands(input)).toEqual({text:input,commands:[]});
  });

  it('finds a command query after whitespace and inserts the selected command',()=>{
    const text='Please /ne review',query=activeComposerCommandQuery(text,10);
    expect(query).toEqual({start:7,end:10,query:'ne'});
    expect(insertComposerCommandAt(text,composerCommands[0],query!)).toEqual({text:'Please /new review',caret:11});
  });

  it('does not open a command query inside words, escapes, or code',()=>{
    expect(activeComposerCommandQuery('word/ne',7)).toBeUndefined();
    expect(activeComposerCommandQuery('\\/ne',4)).toBeUndefined();
    expect(activeComposerCommandQuery('`/ne',4)).toBeUndefined();
    expect(activeComposerCommandQuery('    /ne',7)).toBeUndefined();
  });
});
