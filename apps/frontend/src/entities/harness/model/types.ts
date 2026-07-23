export type HarnessCatalogItem = { id: string; label?: string };
export type HarnessCatalogModel = HarnessCatalogItem & {reasoningEfforts?:string[];defaultReasoningEffort?:string|null};

export type HarnessInstance = {
  id: string;
  type: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  capabilities: string[];
  models: HarnessCatalogModel[];
  controls:{nativeWorkflowModes:Array<'plan'|'work'>;permissionProfiles:HarnessCatalogItem[];agentVariants:HarnessCatalogItem[]};
  error?: { code: string; message: string };
};

export type HarnessCatalog = {
  connectorEpoch: string;
  instances: HarnessInstance[];
};
