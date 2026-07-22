export type HarnessCatalogItem = { id: string; label?: string; supportedModeIds?:string[] };

export type HarnessInstance = {
  id: string;
  type: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  capabilities: string[];
  models: HarnessCatalogItem[];
  modes: HarnessCatalogItem[];
  error?: { code: string; message: string };
};

export type HarnessCatalog = {
  connectorEpoch: string;
  instances: HarnessInstance[];
};
