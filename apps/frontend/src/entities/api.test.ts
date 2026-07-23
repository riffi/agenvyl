import { afterEach, describe, expect, it, vi } from 'vitest';
import { personasApi } from './persona/api';
import { roomsApi } from './room/api';
import { runsApi } from './run/api';
import {personaGroupsApi} from './persona-group/api';
import {harnessesApi} from './harness/api';
import {userProfileApi} from './user-profile';

afterEach(() => vi.unstubAllGlobals());

describe('entity APIs', () => {
  it('builds persona filters without leaking query construction to consumers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('[]'));
    vi.stubGlobal('fetch', fetchMock);
    await personasApi.list({ roomId: 'room / one', includeArchived: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/personas?room_id=room+%2F+one&include_archived=true', expect.any(Object));
  });

  it('encodes room membership paths', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await roomsApi.removeParticipant('room/1', 'persona/1');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/rooms/room%2F1/participants/persona%2F1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('renames rooms through the existing room endpoint', async () => {
    const renamed = { id: 'room/1', title: 'Новое название', created_at: '2026-07-20', participant_count: 1, last_message_at: null, last_message_text: null };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(renamed));
    vi.stubGlobal('fetch', fetchMock);
    await expect(roomsApi.rename('room/1', 'Новое название')).resolves.toEqual(renamed);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/rooms/room%2F1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: 'Новое название' }) }));
  });

  it('sends persona group reorder commands',async()=>{const fetchMock=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({id:'group/1',name:'Code',position:0})));vi.stubGlobal('fetch',fetchMock);await personaGroupsApi.move('group/1','up');expect(fetchMock).toHaveBeenCalledWith('/api/v1/persona-groups/group%2F1/move',expect.objectContaining({method:'POST',body:JSON.stringify({direction:'up'})}));});

  it('persists direct group positions and partial persona moves',async()=>{const fetchMock=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify({id:'item',name:'Item',position:2})));vi.stubGlobal('fetch',fetchMock);await personaGroupsApi.reorder('group/1',2);await personasApi.moveToGroup('persona/1','group/1');expect(fetchMock).toHaveBeenNthCalledWith(1,'/api/v1/persona-groups/group%2F1/reorder',expect.objectContaining({method:'POST',body:JSON.stringify({position:2})}));expect(fetchMock).toHaveBeenNthCalledWith(2,'/api/v1/personas/persona%2F1',expect.objectContaining({method:'PUT',body:JSON.stringify({group_id:'group/1'})}));});

  it('sends run commands through the shared client', async () => {
    const message = { id: 'message-1', text: 'hello', targets: ['coder'], runIds: [], createdAt: '2026-07-15T00:00:00.000Z' };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(message), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(runsApi.sendMessage('room-1', 'hello', ['coder'], 'message-1')).resolves.toEqual(message);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/rooms/room-1/messages', expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: 'hello', message_id: 'message-1', targets: ['coder'] }) }));
  });

  it('loads the aggregated harness catalog through the typed gateway', async () => {
    const catalog={connectorEpoch:'epoch-1',instances:[{id:'local-hermes',type:'hermes',status:'healthy',capabilities:['model_catalog'],models:[{id:'sol',label:'Sonnet'}],controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]}}]};
    const fetchMock=vi.fn<typeof fetch>().mockResolvedValue(Response.json(catalog));
    vi.stubGlobal('fetch',fetchMock);
    await expect(harnessesApi.catalog()).resolves.toEqual(catalog);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/harnesses',expect.any(Object));
  });

  it('loads and saves local user profile settings through the typed gateway',async()=>{
    const profile={id:'local-user',displayName:'Пользователь',handle:'user',createdAt:'2026-01-01',updatedAt:'2026-01-01'};
    const fetchMock=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(profile)).mockResolvedValueOnce(Response.json({...profile,displayName:'Анна',handle:'anna'}));
    vi.stubGlobal('fetch',fetchMock);
    await expect(userProfileApi.get()).resolves.toEqual(profile);
    await expect(userProfileApi.update({display_name:'Анна',handle:'@Anna'})).resolves.toMatchObject({displayName:'Анна',handle:'anna'});
    expect(fetchMock).toHaveBeenNthCalledWith(1,'/api/v1/user-profile',expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2,'/api/v1/user-profile',expect.objectContaining({method:'PUT',body:JSON.stringify({display_name:'Анна',handle:'@Anna'})}));
  });
});
