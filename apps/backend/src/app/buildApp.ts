import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { registerMessageRoutes } from '../modules/messages/messages.routes.js';
import { registerPersonaRoutes } from '../modules/personas/personas.routes.js';
import {registerPersonaGroupRoutes} from '../modules/persona-groups/personaGroups.routes.js';
import { registerRoomEventsWebSocket } from '../infrastructure/realtime/roomEventsWebSocket.js';
import { registerRoomRoutes } from '../modules/rooms/rooms.routes.js';
import { registerRunRoutes } from '../modules/runs/runs.routes.js';
import { resolveAppConfig } from './config.js';
import { createAppContainer } from './container.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerHealthRoutes } from './plugins/health.js';
import { registerStaticFrontend } from './plugins/staticFrontend.js';
import {registerWorkspaceRoutes} from '../modules/workspace/workspace.routes.js';
import {registerConnectorRoutes} from '../modules/connector/connector.routes.js';
import {registerUserProfileRoutes} from '../modules/user-profile/userProfile.routes.js';
import {registerSetupRoutes} from '../modules/setup/setup.routes.js';
import {registerFeatureRoutes} from '../modules/features/features.routes.js';

export type AppOptions = { databaseUrl?: string; connectorUrl?:string; connectorToken?:string; fetch?: typeof fetch; distPath?: string; runConcurrency?: number; runTimeoutMs?:number; shutdownTimeoutMs?: number; websocketMaxBufferedBytes?: number; workspaceRoot?:string; workspaceAgentRoot?:string; workspaceMaxFileBytes?:number; planModeEnabled?:boolean; previewOrigin?:string; logger?:boolean;legacySeed?:boolean };

export async function buildApp(options: AppOptions = {}) {
  const config = resolveAppConfig({
    databaseUrl: options.databaseUrl,
    connectorUrl:options.connectorUrl,
    connectorToken:options.connectorToken,
    distPath: options.distPath,
    runConcurrency:options.runConcurrency,
    runTimeoutMs:options.runTimeoutMs,
    shutdownTimeoutMs:options.shutdownTimeoutMs,
    websocketMaxBufferedBytes:options.websocketMaxBufferedBytes,
    workspaceRoot:options.workspaceRoot,
    workspaceAgentRoot:options.workspaceAgentRoot,
    workspaceMaxFileBytes:options.workspaceMaxFileBytes,
    planModeEnabled:options.planModeEnabled,
    previewOrigin:options.previewOrigin,
  });
  const app = Fastify({ logger: options.logger === false ? false : { redact: ['req.headers.authorization', 'req.headers.x-api-key'] } });
  const { database, events, dependencyHealth, runExecutor, roomsService, personasService, userProfileService, personaGroupsService, createMessageRound, runsService,roomWorkspace,harnessCatalogService,setupService } = await createAppContainer(config, options.fetch,app.log,options.legacySeed);

  await registerErrorHandler(app);
  await app.register(websocket);
  app.addHook('onClose', async () => {
    await runExecutor.shutdown(config.shutdownTimeoutMs);
    roomWorkspace.close();
    await database.close();
  });
  await registerHealthRoutes(app, dependencyHealth,database);
  await registerFeatureRoutes(app,{planMode:config.planModeEnabled,previewOrigin:config.previewOrigin});
  await registerConnectorRoutes(app,harnessCatalogService);
  await registerSetupRoutes(app,setupService);
  await registerRoomRoutes(app, roomsService);
  await registerWorkspaceRoutes(app,roomWorkspace);
  await registerPersonaRoutes(app, personasService);
  await registerUserProfileRoutes(app,userProfileService);
  await registerPersonaGroupRoutes(app,personaGroupsService);

  await registerRoomEventsWebSocket(app, events,config.websocketMaxBufferedBytes);

  await registerMessageRoutes(app, createMessageRound);

  await registerRunRoutes(app, runsService);

  await registerStaticFrontend(app, config.distPath);
  return app;
}
