import { createRepositories } from '../infrastructure/database/createRepositories.js';
import { RoomEventBus } from '../modules/room-events/RoomEventBus.js';
import { RoomEventService } from '../modules/room-events/RoomEventService.js';
import { ActiveRunRegistry } from '../modules/runs/ActiveRunRegistry.js';
import { RunExecutor } from '../modules/runs/RunExecutor.js';
import type { AppConfig } from './config.js';
import {RoomsService} from '../modules/rooms/rooms.service.js';
import {PersonasService} from '../modules/personas/personas.service.js';
import {CreateMessageRound} from '../modules/messages/createMessageRound.js';
import {RunsService} from '../modules/runs/runs.service.js';
import {PersonaGroupsService} from '../modules/persona-groups/personaGroups.service.js';
import type {FastifyBaseLogger} from 'fastify';
import {RoomWorkspaceService} from '../modules/workspace/RoomWorkspaceService.js';
import {HttpConnectorClient} from '../integrations/connector/HttpConnectorClient.js';
import {HarnessCatalogService} from '../modules/connector/HarnessCatalogService.js';
import {ConnectorRunAdapter} from '../integrations/connector/ConnectorRunAdapter.js';
import {UserProfileService} from '../modules/user-profile/userProfile.service.js';
import {SetupService} from '../modules/setup/SetupService.js';

export async function createAppContainer(config: AppConfig, fetchImplementation?: typeof fetch,logger?:FastifyBaseLogger,legacySeed?:boolean) {
  const {database,personas,userProfile,personaGroups,rooms,roomEvents,messages,runs,workspace,workspaceSnapshots,workspaceSlots}=await createRepositories(config.databaseUrl,{legacySeed:legacySeed??process.env.NODE_ENV==='test'});
  const eventBus = new RoomEventBus();
  const events = new RoomEventService(roomEvents,eventBus);
  const connector=new HttpConnectorClient(config.connectorUrl,config.connectorToken,fetchImplementation);
  const harnessCatalogService=new HarnessCatalogService(connector,{logger});
  const connectorRuns=new ConnectorRunAdapter(connector);
  const activeRuns = new ActiveRunRegistry();
  const roomWorkspace=new RoomWorkspaceService(rooms,workspace,events,activeRuns,config.workspaceRoot,config.workspaceAgentRoot,config.workspaceMaxFileBytes,config.planModeEnabled,workspaceSnapshots,logger,{
    noopMode:config.workspaceNoopMode,
    warmSlotsMode:config.workspaceWarmSlotsMode,
    statCacheMode:config.workspaceStatCacheMode,
    slotLeaseMs:config.runTimeoutMs+5*60_000,
  },workspaceSlots);

  const runExecutor=new RunExecutor({ personas, runs, events, runGateway:connectorRuns, runEvents:connectorRuns, connectorExecution:connectorRuns,activeRuns,concurrency:config.runConcurrency,runTimeoutMs:config.runTimeoutMs,logger,roomWorkspace,messages,connector,planModeEnabled:config.planModeEnabled });
  await roomWorkspace.recover();
  await runExecutor.reconcilePersistedRuns();
  await roomWorkspace.recoverRuns();
  return {
    database,
    personas,
    rooms,
    messages,
    runs,
    events,
    dependencyHealth:connectorRuns,
    activeRuns,
    runExecutor,
    roomsService:new RoomsService(rooms,roomWorkspace,events,config.planModeEnabled,harnessCatalogService),
    personasService:new PersonasService(personas,rooms,harnessCatalogService),
    userProfileService:new UserProfileService(userProfile),
    personaGroupsService:new PersonaGroupsService(personaGroups),
    createMessageRound:new CreateMessageRound({personas,rooms,messages,events,harnesses:harnessCatalogService,activeRuns,runExecutor,roomWorkspace,planModeEnabled:config.planModeEnabled}),
    runsService:new RunsService({runs,events,activeRuns,executor:runExecutor,planModeEnabled:config.planModeEnabled}),
    harnessCatalogService,
    roomWorkspace,
    setupService:new SetupService(database,connector,config.workspaceRoot,harnessCatalogService,{logger}),
  };
}

export type AppContainer = ReturnType<typeof createAppContainer>;
