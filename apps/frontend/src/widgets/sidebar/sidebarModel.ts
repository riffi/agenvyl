import type { Room } from '../../entities/room';

export type RoomListItem =
  | { type: 'group'; id: string; label: string }
  | { type: 'room'; id: string; room: Room };

const activityDate = (room: Room) => new Date(room.last_message_at ?? room.created_at);

export function groupRooms(rooms: Room[], now = new Date()): RoomListItem[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const previousWeek = new Date(today);
  previousWeek.setDate(previousWeek.getDate() - 7);

  const groups = [
    { id: 'today', label: 'Сегодня', rooms: [] as Room[] },
    { id: 'week', label: 'Предыдущие 7 дней', rooms: [] as Room[] },
    { id: 'earlier', label: 'Ранее', rooms: [] as Room[] },
  ];

  for (const room of rooms) {
    const activity = activityDate(room);
    if (activity >= today) groups[0].rooms.push(room);
    else if (activity >= previousWeek) groups[1].rooms.push(room);
    else groups[2].rooms.push(room);
  }

  return groups.flatMap(group => group.rooms.length
    ? [{ type: 'group' as const, id: `group-${group.id}`, label: group.label }, ...group.rooms.map(room => ({ type: 'room' as const, id: room.id, room }))]
    : []);
}

export function filterRooms(rooms: Room[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized ? rooms.filter(room => room.title.toLocaleLowerCase().includes(normalized)) : rooms;
}
