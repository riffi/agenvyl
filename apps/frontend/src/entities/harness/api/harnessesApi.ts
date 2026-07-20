import { apiRequest } from '../../../shared/api';
import type { HarnessCatalog } from '../model';

export const harnessKeys = { catalog: ['harnesses'] as const };

export const harnessesApi = {
  catalog: (signal?: AbortSignal) => apiRequest<HarnessCatalog>('/api/v1/harnesses', { signal }),
};
