import { apiRequest } from '../../../shared/api';
import type {ConfigureSetupHarnessesRequest,HarnessSettingsState} from '@agenvyl/contracts';
import type { HarnessCatalog } from '../model';

export const harnessKeys = { catalog: ['harnesses'] as const,settings:['harness-settings'] as const };

export const harnessesApi = {
  catalog: (signal?: AbortSignal) => apiRequest<HarnessCatalog>('/api/v1/harnesses', { signal }),
  settings:(signal?:AbortSignal)=>apiRequest<HarnessSettingsState>('/api/v1/harness-settings',{signal}),
  configure:(input:ConfigureSetupHarnessesRequest)=>apiRequest('/api/v1/harness-settings',{method:'PUT',body:input}),
};
