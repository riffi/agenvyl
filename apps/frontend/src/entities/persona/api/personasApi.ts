import type { Persona } from '../model';
import type { PersonaInput, UpdatePersonaRequest } from '@agenvyl/contracts';
import { apiRequest } from '../../../shared/api';

export type { PersonaInput } from '@agenvyl/contracts';

export const personaKeys = {
  all: ['personas'] as const,
  catalog: () => [...personaKeys.all, 'catalog'] as const,
  byRoom: (roomId: string) => [...personaKeys.all, 'room', roomId] as const,
  detail: (id: string) => [...personaKeys.all, 'detail', id] as const,
};

export const personasApi = {
  list: (options: { roomId?: string; includeArchived?: boolean; signal?: AbortSignal } = {}) => {
    const query = new URLSearchParams();
    if (options.roomId) query.set('room_id', options.roomId);
    if (options.includeArchived) query.set('include_archived', 'true');
    return apiRequest<Persona[]>(`/api/v1/personas${query.size ? `?${query}` : ''}`, { signal: options.signal });
  },
  detail: (id: string, signal?: AbortSignal) => apiRequest<Persona>(`/api/v1/personas/${encodeURIComponent(id)}`, { signal }),
  create: (input: PersonaInput) => apiRequest<Persona>('/api/v1/personas', { method: 'POST', body: input }),
  update: (id: string, input: UpdatePersonaRequest) => apiRequest<Persona>(`/api/v1/personas/${encodeURIComponent(id)}`, { method: 'PUT', body: input }),
  moveToGroup: (id: string, groupId: string | null) => apiRequest<Persona>(`/api/v1/personas/${encodeURIComponent(id)}`, { method: 'PUT', body: { group_id: groupId } }),
  archive: (id: string) => apiRequest(`/api/v1/personas/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
  restore: (id: string) => apiRequest(`/api/v1/personas/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  remove: (id: string) => apiRequest(`/api/v1/personas/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
