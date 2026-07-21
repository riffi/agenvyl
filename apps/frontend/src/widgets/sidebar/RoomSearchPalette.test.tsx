// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '../../entities/room';
import { RoomSearchPalette } from './Sidebar';

const rooms: Room[] = [
  { id: 'one', title: 'Первая комната', created_at: '2026-07-20', participant_count: 1, last_message_at: null, last_message_text: null },
  { id: 'two', title: 'Вторая комната', created_at: '2026-07-19', participant_count: 1, last_message_at: null, last_message_text: null },
];

afterEach(cleanup);

describe('room search palette', () => {
  it('filters locally by title', async () => {
    const user = userEvent.setup();
    render(<RoomSearchPalette rooms={rooms} selectedRoomId="one" onSelect={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByRole('textbox'), 'вторая');
    expect(screen.queryByText('Первая комната')).toBeNull();
    expect(screen.getByText('Вторая комната')).toBeTruthy();
  });

  it('supports arrow navigation and enter selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn(), onClose = vi.fn();
    render(<RoomSearchPalette rooms={rooms} selectedRoomId="one" onSelect={onSelect} onClose={onClose} />);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(rooms[1]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RoomSearchPalette rooms={rooms} selectedRoomId="one" onSelect={vi.fn()} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('provides an explicit close action for touch layouts', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RoomSearchPalette rooms={rooms} selectedRoomId="one" onSelect={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Close search' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
