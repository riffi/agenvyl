import type {HarnessCacheMetadata} from '@agenvyl/contracts';

export type HarnessCatalogItem = { id: string; label?: string };
export type HarnessCatalogModel = HarnessCatalogItem & {reasoningEfforts?:string[];defaultReasoningEffort?:string|null};
export type HarnessInstanceCatalogCache={
  state:'fresh'|'stale'|'unavailable';
  refreshedAt:string|null;
  error?:{code:string;message:string};
};

export type HarnessInstance = {
  id: string;
  type: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  capabilities: string[];
  models: HarnessCatalogModel[];
  controls:{nativeWorkflowModes:Array<'plan'|'work'>;permissionProfiles:HarnessCatalogItem[];agentVariants:HarnessCatalogItem[]};
  catalogCache:HarnessInstanceCatalogCache;
  error?: { code: string; message: string };
};

export type HarnessCatalog = {
  connectorEpoch: string;
  instances: HarnessInstance[];
  cache:HarnessCacheMetadata;
};
