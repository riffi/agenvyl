import { MessageRepository } from '../../modules/messages/messages.repository.js';
import { PersonaRepository } from '../../modules/personas/personas.repository.js';
import { RoomEventRepository } from '../../modules/room-events/roomEvents.repository.js';
import { RoomRepository } from '../../modules/rooms/rooms.repository.js';
import { RunRepository } from '../../modules/runs/runs.repository.js';
import {PersonaGroupRepository} from '../../modules/persona-groups/personaGroups.repository.js';
import { Database } from './Database.js';
import {WorkspaceRepository} from '../../modules/workspace/workspace.repository.js';
import {WorkspaceSnapshotRepository} from '../../modules/workspace/workspaceSnapshots.repository.js';
import {UserProfileRepository} from '../../modules/user-profile/userProfile.repository.js';

export async function createRepositories(databaseUrl:string,options:{legacySeed?:boolean}={}){
  const database=await Database.connect(databaseUrl);
  if(options.legacySeed??process.env.NODE_ENV==='test'){const{seedLegacyTestDatabase}=await import('../../test/legacySeed.js');await seedLegacyTestDatabase(database);}
  const personas=new PersonaRepository(database);
  const roomEvents=new RoomEventRepository(database);
  const workspace=new WorkspaceRepository(database),workspaceSnapshots=new WorkspaceSnapshotRepository(database),rooms=new RoomRepository(database,personas,workspace,roomEvents);
  const userProfile=new UserProfileRepository(database);
  return{database,personas,userProfile,personaGroups:new PersonaGroupRepository(database),rooms,messages:new MessageRepository(database,personas,userProfile,roomEvents,workspace),runs:new RunRepository(database,roomEvents),roomEvents,workspace,workspaceSnapshots};
}
