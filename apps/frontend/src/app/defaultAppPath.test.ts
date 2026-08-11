import {describe,expect,it} from 'vitest';
import type {Room,SetupState} from '@agenvyl/contracts';
import {defaultAppPath} from './defaultAppPath';

const setup=(completed:boolean,firstRoomId?:string)=>({completed,firstRoomId} as SetupState);
const room=(id:string)=>({id} as Room);

describe('defaultAppPath',()=>{
  it('opens the most recently active room returned by the room list',()=>{
    expect(defaultAppPath(setup(true,'initial-room'),[room('latest/room'),room('older-room')])).toBe('/rooms/latest%2Froom');
  });

  it('falls back to the setup room when no active rooms are returned',()=>{
    expect(defaultAppPath(setup(true,'initial-room'),[])).toBe('/rooms/initial-room');
  });

  it('keeps incomplete installations in setup',()=>{
    expect(defaultAppPath(setup(false,'initial-room'),[room('latest-room')])).toBe('/setup');
  });
});
