import type {Room,SetupState} from '@agenvyl/contracts';

export const defaultAppPath=(setup:SetupState,rooms:Room[])=>{
  if(!setup.completed)return'/setup';
  const roomId=rooms[0]?.id??setup.firstRoomId;
  return roomId?`/rooms/${encodeURIComponent(roomId)}`:'/setup';
};
