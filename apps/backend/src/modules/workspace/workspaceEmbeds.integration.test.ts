import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {describe,expect,it,vi} from 'vitest';
import {createRepositories} from '../../infrastructure/database/createRepositories.js';
import {testDatabaseUrl} from '../../testDatabase.js';
import {RoomEventBus} from '../room-events/RoomEventBus.js';
import {RoomEventService} from '../room-events/RoomEventService.js';
import {ActiveRunRegistry} from '../runs/ActiveRunRegistry.js';
import {RoomWorkspaceService} from './RoomWorkspaceService.js';
import {CreateMessageRound} from '../messages/createMessageRound.js';

const workProfile={workflowMode:'work' as const,requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,planEnforcement:null,permissionProfileId:null,agentVariantId:null,approvedPlanRunId:null};

describe('persisted workspace embeds',()=>{
  it('pins the resolved image version and keeps snapshot metadata out of natural-language history',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'workspace-embeds-')),repositories=await createRepositories(testDatabaseUrl('run_embed_pin')),events=new RoomEventService(repositories.roomEvents,new RoomEventBus()),activeRuns=new ActiveRunRegistry(),workspace=new RoomWorkspaceService(repositories.rooms,repositories.workspace,events,activeRuns,root,root,10*1024*1024);
    try{
      const first=await workspace.upload('demo-room','charts/result.png','image/png',png('first'));
      const persona=(await repositories.personas.find('persona-architect'))!,round=await repositories.messages.createRound('demo-room','show it',[persona],new Map([[persona.id,workProfile]]));
      const embeds=await workspace.resolveRunEmbeds('demo-room',round.runs[0].id,'Result:\n![Chart](workspace:charts/result.png)');
      expect(embeds[0]).toMatchObject({status:'resolved',attachment:{version_id:first.version!.id}});
      await repositories.roomEvents.append('demo-room','run.delta',{runId:round.runs[0].id,text:'Result:\n![Chart](workspace:charts/result.png)'});await repositories.roomEvents.append('demo-room','run.status',{runId:round.runs[0].id,status:'completed'});
      await workspace.upload('demo-room','charts/result.png','image/png',png('second'),'replace');
      const timeline=await repositories.rooms.timeline('demo-room',undefined,30);
      expect(timeline?.runs[0].embeds?.[0]).toMatchObject({status:'resolved',attachment:{version_id:first.version!.id}});
      const service=new CreateMessageRound({personas:repositories.personas,rooms:repositories.rooms,messages:repositories.messages,events,harnesses:{catalog:vi.fn().mockResolvedValue({instances:[{id:'local-hermes',type:'hermes',status:'healthy',models:[{id:'sol',label:'model'}],controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]}}]})},activeRuns,runExecutor:{start:vi.fn()},roomWorkspace:workspace} as never),next=await service.execute({roomId:'demo-room',text:'next',targets:['architect']});
      const context=await repositories.messages.conversationContextForRun('demo-room','architect',next.message.id);
      expect(context.references).toContainEqual({path:'charts/result.png',versionId:first.version!.id});
      expect(context.history.every(item=>!item.content.includes('Зафиксированные inline-изображения ответа'))).toBe(true);
      await workspace.upload('demo-room','fake.jpg','image/jpeg',Buffer.from('<html>not an image</html>'));
      await expect(workspace.resolveRunEmbeds('demo-room',next.message.runIds[0],'![Fake](workspace:fake.jpg)')).resolves.toEqual([{kind:'image',path:'fake.jpg',status:'error',error:'invalid_content'}]);
    }finally{workspace.close();await repositories.database.close();await rm(root,{recursive:true,force:true});}
  });
});

function png(label:string){return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.from(label)]);}
