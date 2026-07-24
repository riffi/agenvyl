import path from 'node:path';

export type RunWorkspaceDriverKind='legacy'|'warm';

export type RunWorkspaceDriverPath={
  root:string;
  relativePath:string;
  absolutePath:string;
  driver:RunWorkspaceDriverKind;
};

export type WarmSlotIdentity={
  personaId:string;
  slotIndex:number;
};

export interface RunWorkspaceDriver{
  readonly kind:RunWorkspaceDriverKind;
  path(roomId:string,runId:string,slot?:WarmSlotIdentity):RunWorkspaceDriverPath;
}

export class LegacyRunWorkspaceDriver implements RunWorkspaceDriver{
  readonly kind='legacy' as const;
  constructor(private readonly workspaceRoot:string,private readonly agentRoot:string){}

  path(roomId:string,runId:string):RunWorkspaceDriverPath{
    const relativePath=`.agenvyl/runs/${runId}/workspace`;
    return{
      root:path.join(path.resolve(this.workspaceRoot),roomId,...relativePath.split('/')),
      relativePath,
      absolutePath:path.join(path.resolve(this.agentRoot),roomId,...relativePath.split('/')),
      driver:this.kind,
    };
  }
}

export class WarmSlotWorkspaceDriver implements RunWorkspaceDriver{
  readonly kind='warm' as const;
  constructor(private readonly workspaceRoot:string,private readonly agentRoot:string){}

  path(roomId:string,_runId:string,slot?:WarmSlotIdentity):RunWorkspaceDriverPath{
    if(!slot)throw new Error('Warm workspace driver requires a slot identity');
    const relativePath=`.agenvyl/agents/${slot.personaId}/slots/${slot.slotIndex}/workspace`;
    return{
      root:path.join(path.resolve(this.workspaceRoot),roomId,...relativePath.split('/')),
      relativePath,
      absolutePath:path.join(path.resolve(this.agentRoot),roomId,...relativePath.split('/')),
      driver:this.kind,
    };
  }
}
