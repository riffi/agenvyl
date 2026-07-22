import type { Message } from '../../message';
import type { AgentHandle } from '../model';
import { apiRequest } from '../../../shared/api';
import type {ExecutionIntent} from '@agenvyl/contracts';

export const runsApi = {
  sendMessage: (roomId: string, text: string, targets?: AgentHandle[], messageId: string = crypto.randomUUID(),attachmentVersionIds:string[]=[],executionIntent?:ExecutionIntent) => apiRequest<Message>(`/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, { method: 'POST', body: { text, message_id: messageId,...(attachmentVersionIds.length?{attachment_version_ids:attachmentVersionIds}:{}),...(executionIntent?{execution_intent:executionIntent}:{}), ...(targets === undefined ? {} : { targets }) } }),
  resolve: (runId: string, resolution: import('@agenvyl/contracts').RunRequestResolution|string) => apiRequest(`/api/v1/runs/${encodeURIComponent(runId)}/request`, { method: 'POST', body: typeof resolution==='string'?{resolution}:resolution }),
  cancel: (runId: string) => apiRequest(`/api/v1/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: {} }),
  retry: (runId: string) => apiRequest(`/api/v1/runs/${encodeURIComponent(runId)}/retry`, { method: 'POST', body: {} }),
  select: (runId: string) => apiRequest(`/api/v1/runs/${encodeURIComponent(runId)}/select`, { method: 'POST', body: {} }),
};
