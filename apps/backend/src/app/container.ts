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
import {ProjectsService} from '../modules/projects/projects.service.js';
import {RunInterventionService} from '../modules/runs/RunInterventionService.js';
import {PreviewBundleStore} from '../modules/workspace/PreviewBundleStore.js';

export async function createAppContainer(config: AppConfig, fetchImplementation?: typeof fetch,logger?:FastifyBaseLogger,legacySeed?:boolean) {
  const {database,personas,userProfile,personaGroups,projects,rooms,roomEvents,messages,runs,workspace,runWorkspaces}=await createRepositories(config.databaseUrl,{legacySeed:legacySeed??process.env.NODE_ENV==='test'});
  const[installation]=await database.sql`SELECT completed_at,workspace_root FROM installation_state WHERE id=true`;
  const persistedWorkspaceRoot=installation.completed_at&&String(installation.workspace_root??'').trim()?String(installation.workspace_root):undefined;
  const workspaceRoot=persistedWorkspaceRoot??config.workspaceRoot;
  const workspaceAgentRoot=persistedWorkspaceRoot&&config.workspaceAgentRoot===config.workspaceRoot?persistedWorkspaceRoot:config.workspaceAgentRoot;
  const eventBus = new RoomEventBus();
  const events = new RoomEventService(roomEvents,eventBus);
  const connector=new HttpConnectorClient(config.connectorUrl,config.connectorToken,fetchImplementation,{
    onStreamRetry:details=>logger?.warn({connectorExecutionId:details.executionId,connectorCursor:details.cursor,attempt:details.attempt,delayMs:details.delayMs,err:details.error},'Connector event stream interrupted; reconnecting'),
  });
  const harnessCatalogService=new HarnessCatalogService(connector,{logger});
  const connectorRuns=new ConnectorRunAdapter(connector);
  const activeRuns = new ActiveRunRegistry();
  const previewBundles=new PreviewBundleStore(config.artifactRoot,config.artifactMaxBytes);
  const roomWorkspace=new RoomWorkspaceService(rooms,workspace,runWorkspaces,events,activeRuns,workspaceRoot,workspaceAgentRoot,config.workspaceMaxFileBytes,logger,previewBundles);

  const runExecutor=new RunExecutor({ personas, runs, events, runGateway:connectorRuns, runEvents:connectorRuns, connectorExecution:connectorRuns,activeRuns,concurrency:config.runConcurrency,runTimeoutMs:config.runTimeoutMs,logger,roomWorkspace,messages,connector });
  const runInterventions=new RunInterventionService({runs,activeRuns,gateway:connectorRuns});
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
    roomsService:new RoomsService(rooms,roomWorkspace,events,harnessCatalogService),
    personasService:new PersonasService(personas,rooms,harnessCatalogService),
    userProfileService:new UserProfileService(userProfile),
    personaGroupsService:new PersonaGroupsService(personaGroups),
    createMessageRound:new CreateMessageRound({personas,rooms,messages,events,harnesses:harnessCatalogService,activeRuns,runExecutor,roomWorkspace}),
    runsService:new RunsService({runs,events,activeRuns,executor:runExecutor,interventions:runInterventions}),
    harnessCatalogService,
    roomWorkspace,
    setupService:new SetupService(database,connector,workspaceRoot,harnessCatalogService,{logger,roomWorkspace}),
    projectsService:new ProjectsService(projects,connector),
  };
}

export type AppContainer = ReturnType<typeof createAppContainer>;
