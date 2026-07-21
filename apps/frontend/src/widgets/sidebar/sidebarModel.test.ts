import { describe, expect, it } from 'vitest';
import type { Room } from '../../entities/room';
import { filterRooms, groupRooms } from './sidebarModel';

const room = (id: string, title: string, createdAt: string, lastMessageAt: string | null = null): Room => ({
  id,
  title,
  created_at: createdAt,
  participant_count: 0,
  last_message_at: lastMessageAt,
  last_message_text: null,
});

describe('sidebar room model', () => {
  it('groups rooms by local activity date and preserves source ordering', () => {
    const items = groupRooms([
      room('today', 'Сегодня', '2026-07-20T08:00:00'),
      room('week', 'На неделе', '2026-01-01T08:00:00', '2026-07-16T12:00:00'),
      room('earlier', 'Ранее', '2026-07-01T08:00:00'),
    ], new Date('2026-07-20T14:00:00'));

    expect(items.map(item => item.type === 'group' ? item.label : item.room.id)).toEqual([
      'Today', 'today', 'Previous 7 days', 'week', 'Earlier', 'earlier',
    ]);
  });

  it('omits empty time groups', () => {
    expect(groupRooms([room('old', 'Старая', '2026-01-01T08:00:00')], new Date('2026-07-20T14:00:00')).map(item => item.type)).toEqual(['group', 'room']);
  });

  it('filters titles case-insensitively without changing result order', () => {
    const rooms = [room('a', 'Release Notes', '2026-07-20'), room('b', 'РЕЛИЗ backend', '2026-07-19'), room('c', 'Ideas', '2026-07-18')];
    expect(filterRooms(rooms, '  релиз  ').map(item => item.id)).toEqual(['b']);
    expect(filterRooms(rooms, '').map(item => item.id)).toEqual(['a', 'b', 'c']);
  });
});
