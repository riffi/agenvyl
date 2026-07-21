import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MoreHorizontal, Plus, RotateCcw, Search, Settings, Trash2, Users, X } from 'lucide-react';
import type { Room } from '../../entities/room';
import type { LocalUserProfile, UpdateLocalUserProfileRequest } from '../../entities/user-profile';
import { Alert, Button, Dialog, IconButton, Input } from '../../shared/ui';
import { filterRooms, groupRooms } from './sidebarModel';
import styles from './Sidebar.module.css';

const Portal = ({ children }: { children: ReactNode }) => typeof document === 'undefined' ? null : createPortal(children, document.body);

export type SidebarProps = {
  open: boolean;
  close: () => void;
  view: 'chat' | 'personas';
  openPersonas: () => void;
  rooms: Room[];
  selectedRoomId: string;
  selectRoom: (id: string) => void;
  createRoom: () => void;
  renameRoom: (room: Room, title: string) => Promise<void>;
  deleteRoom: (room: Room) => Promise<void>;
  deletedRooms?: Room[];
  restoreRoom?: (room: Room) => Promise<void>;
  purgeRoom?: (room: Room) => Promise<void>;
  userProfile?: LocalUserProfile;
  userProfileLoading?: boolean;
  userProfileError?: string;
  saveUserProfile?: (input: UpdateLocalUserProfileRequest) => Promise<LocalUserProfile>;
};

type PositionedRoomMenu = { room: Room; top: number; left: number };
type ProfileMenuPosition = { left: number; bottom: number; width: number };

export function Sidebar({ open, close, view, openPersonas, rooms, selectedRoomId, selectRoom, createRoom, renameRoom, deleteRoom, deletedRooms = [], restoreRoom, purgeRoom, userProfile, userProfileLoading, userProfileError, saveUserProfile }: SidebarProps) {
  const [deleting, setDeleting] = useState<string>();
  const [roomError, setRoomError] = useState<string>();
  const [profileOpen, setProfileOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [renaming, setRenaming] = useState<Room>();
  const [roomMenu, setRoomMenu] = useState<PositionedRoomMenu>();
  const [profileMenu, setProfileMenu] = useState<ProfileMenuPosition>();
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const roomList = useMemo(() => groupRooms(rooms), [rooms]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: roomList.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => roomList[index]?.type === 'group' ? 29 : 36,
    getItemKey: index => roomList[index]?.id ?? index,
    overscan: 10,
  });

  const openSearch = () => {
    setRoomMenu(undefined);
    setProfileMenu(undefined);
    setSearchOpen(true);
  };

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setRoomMenu(undefined);
        setProfileMenu(undefined);
        setSearchOpen(true);
      }
    };
    addEventListener('keydown', shortcut);
    return () => removeEventListener('keydown', shortcut);
  }, []);

  const chooseRoom = (room: Room) => {
    selectRoom(room.id);
    close();
  };

  const requestDelete = async (room: Room) => {
    if (!confirm(`Move room “${room.title}” to the trash?\n\nIts history, responses, and workspace will be preserved and can be restored.`)) return;
    setDeleting(room.id);
    setRoomError(undefined);
    try {
      await deleteRoom(room);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(undefined);
    }
  };

  const openRoomMenu = (room: Room, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setProfileMenu(undefined);
    setRoomMenu({ room, top: Math.min(rect.bottom + 4, window.innerHeight - 92), left: Math.max(8, rect.right - 164) });
  };

  const toggleProfileMenu = () => {
    if (profileMenu) {
      setProfileMenu(undefined);
      return;
    }
    const rect = profileButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setRoomMenu(undefined);
    setProfileMenu({ left: rect.left + 10, bottom: window.innerHeight - rect.top + 6, width: rect.width - 20 });
  };

  return (
    <aside className={`${styles.sidebar} ${open ? styles.open : ''}`}>
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden>A</span>
        <strong>agenvyl</strong>
        <IconButton className={styles.searchButton} aria-label="Search rooms" title="Search rooms (Ctrl/Cmd+K)" onClick={openSearch}><Search /></IconButton>
      </div>

      <nav className={styles.mainNav} aria-label="Main navigation">
        <button type="button" onClick={createRoom}><Plus /> <span>New room</span></button>
        <button type="button" className={view === 'personas' ? styles.active : ''} onClick={openPersonas}><Users /> <span>Agents</span></button>
      </nav>

      <section className={styles.history} aria-label="Room history">
        {roomError && <Alert tone="error">{roomError}</Alert>}
        {roomList.length ? <div ref={scrollRef} className={styles.roomScroll} onScroll={() => setRoomMenu(undefined)}>
          <div className={styles.virtualList} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map(virtualItem => {
              const item = roomList[virtualItem.index];
              const position: CSSProperties = { transform: `translateY(${virtualItem.start}px)`, height: virtualItem.size };
              if (item.type === 'group') return <div key={item.id} className={styles.groupLabel} style={position}>{item.label}</div>;
              const selected = view === 'chat' && item.room.id === selectedRoomId;
              return <div key={item.id} className={`${styles.roomRow} ${selected ? styles.selected : ''}`} style={position}>
                <button type="button" className={styles.room} title={item.room.title} onClick={() => chooseRoom(item.room)}>{item.room.title}</button>
                <IconButton className={styles.roomMenuButton} aria-label={`Actions for room ${item.room.title}`} aria-haspopup="menu" aria-expanded={roomMenu?.room.id === item.room.id} onClick={event => openRoomMenu(item.room, event)}><MoreHorizontal /></IconButton>
              </div>;
            })}
          </div>
        </div> : <p className={styles.emptyRooms}>No rooms yet</p>}
      </section>

      <button ref={profileButtonRef} type="button" className={styles.profile} onClick={toggleProfileMenu} aria-label="User profile menu" aria-haspopup="menu" aria-expanded={Boolean(profileMenu)}>
        <b>{userProfile?.displayName.trim().slice(0, 1).toUpperCase() || 'U'}</b>
        <span><strong>{userProfile?.displayName ?? (userProfileLoading ? 'Loading…' : 'User')}</strong><small>{userProfile ? `@${userProfile.handle}` : 'user profile'}</small></span>
        <MoreHorizontal />
      </button>

      {roomMenu && <Portal><div className={styles.menuLayer} onMouseDown={() => setRoomMenu(undefined)}><div className={styles.contextMenu} role="menu" style={{ top: roomMenu.top, left: roomMenu.left }} onMouseDown={event => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => { setRenaming(roomMenu.room); setRoomMenu(undefined); }}>Rename</button>
        <button type="button" role="menuitem" className={styles.danger} disabled={deleting === roomMenu.room.id} onClick={() => { const room = roomMenu.room; setRoomMenu(undefined); void requestDelete(room); }}><Trash2 /> Delete…</button>
      </div></div></Portal>}

      {profileMenu && <Portal><div className={styles.menuLayer} onMouseDown={() => setProfileMenu(undefined)}><div className={`${styles.contextMenu} ${styles.profileMenu}`} role="menu" style={profileMenu} onMouseDown={event => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => { setProfileMenu(undefined); setProfileOpen(true); }}><Settings /> Profile settings</button>
        <button type="button" role="menuitem" onClick={() => { setProfileMenu(undefined); setTrashOpen(true); }}><Trash2 /> <span>Trash</span>{deletedRooms.length > 0 && <small>{deletedRooms.length}</small>}</button>
      </div></div></Portal>}

      {searchOpen && <Portal><RoomSearchPalette rooms={rooms} selectedRoomId={selectedRoomId} onSelect={chooseRoom} onClose={() => setSearchOpen(false)} /></Portal>}
      {renaming && <Portal><RenameRoomDialog room={renaming} onClose={() => setRenaming(undefined)} onRename={renameRoom} /></Portal>}
      {profileOpen && <Portal><UserProfileDialog open profile={userProfile} loading={userProfileLoading} loadError={userProfileError} onClose={() => setProfileOpen(false)} onSave={saveUserProfile} /></Portal>}
      {trashOpen && <Portal><TrashDialog rooms={deletedRooms} restoreRoom={restoreRoom} purgeRoom={purgeRoom} onClose={() => setTrashOpen(false)} /></Portal>}
    </aside>
  );
}

export function RoomSearchPalette({ rooms, selectedRoomId, onSelect, onClose }: { rooms: Room[]; selectedRoomId: string; onSelect: (room: Room) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => filterRooms(rooms, query), [rooms, query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [query]);

  const keyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (!results.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const room = results[Math.min(active, results.length - 1)];
      if (room) { onSelect(room); onClose(); }
    }
  };

  return <div className={styles.searchBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.searchPalette} role="dialog" aria-modal="true" aria-label="Search rooms">
      <div className={styles.searchInput}><Search aria-hidden /><Input ref={inputRef} aria-label="Search room names" placeholder="Find a room…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={keyDown} aria-controls="room-search-results" aria-activedescendant={results[active] ? `room-search-${results[active].id}` : undefined} /><kbd>Esc</kbd><IconButton className={styles.searchClose} aria-label="Close search" onClick={onClose}><X /></IconButton></div>
      <div id="room-search-results" className={styles.searchResults} role="listbox">
        {results.map((room, index) => <button id={`room-search-${room.id}`} key={room.id} type="button" role="option" aria-selected={index === active} className={index === active ? styles.searchSelected : ''} onMouseEnter={() => setActive(index)} onClick={() => { onSelect(room); onClose(); }}><Search aria-hidden /><span>{room.title}</span>{room.id === selectedRoomId && <small>Open</small>}</button>)}
        {!results.length && <p>No rooms found</p>}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> select</span><span><kbd>↵</kbd> open</span></footer>
    </section>
  </div>;
}

export function RenameRoomDialog({ room, onClose, onRename }: { room: Room; onClose: () => void; onRename: (room: Room, title: string) => Promise<void> }) {
  const [title, setTitle] = useState(room.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    const next = title.trim();
    if (!next) { setError('Enter a room name.'); return; }
    setSaving(true); setError(undefined);
    try { await onRename(room, next); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSaving(false); }
  };
  return <Dialog title="Rename room" onClose={onClose} labelledBy="rename-room-title" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving} onClick={() => void submit()}>{saving ? 'Saving…' : 'Save'}</Button></>}>
    <div className={styles.renameForm}><Input autoFocus aria-label="Room name" maxLength={160} value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void submit(); }} />{error && <Alert tone="error">{error}</Alert>}</div>
  </Dialog>;
}

export function TrashDialog({ rooms, restoreRoom, purgeRoom, onClose }: { rooms: Room[]; restoreRoom?: (room: Room) => Promise<void>; purgeRoom?: (room: Room) => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const run = async (key: string, action: (() => Promise<void>) | undefined) => {
    if (!action) return;
    setBusy(key); setError(undefined);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(undefined); }
  };
  return <Dialog title="Trash" description="Deleted rooms can be restored or permanently removed with their history and workspace." onClose={onClose} labelledBy="trash-title" footer={<Button onClick={onClose}>Close</Button>}>
    <div className={styles.trashList}>
      {error && <Alert tone="error">{error}</Alert>}
      {!rooms.length && <p>Trash is empty</p>}
      {rooms.map(room => <div key={room.id} className={styles.trashRow}><span><strong>{room.title}</strong><small>{room.deleted_at ? `Deleted ${new Date(room.deleted_at).toLocaleDateString('en-US')}` : 'Deleted'}</small></span><IconButton aria-label={`Restore room ${room.title}`} title="Restore" disabled={Boolean(busy)} onClick={() => void run(`restore-${room.id}`, () => restoreRoom?.(room) ?? Promise.resolve())}>{busy === `restore-${room.id}` ? '…' : <RotateCcw />}</IconButton><IconButton className={styles.purgeButton} aria-label={`Permanently delete room ${room.title}`} title="Delete permanently" disabled={Boolean(busy)} onClick={() => { if (confirm(`Permanently delete “${room.title}” with its history and workspace? This cannot be undone.`)) void run(`purge-${room.id}`, () => purgeRoom?.(room) ?? Promise.resolve()); }}>{busy === `purge-${room.id}` ? '…' : <Trash2 />}</IconButton></div>)}
    </div>
  </Dialog>;
}

export function UserProfileDialog({ open, profile, loading, loadError, onClose, onSave }: { open: boolean; profile?: LocalUserProfile; loading?: boolean; loadError?: string; onClose: () => void; onSave?: SidebarProps['saveUserProfile'] }) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? ''), [handle, setHandle] = useState(profile?.handle ?? ''), [saving, setSaving] = useState(false), [error, setError] = useState<string>();
  useEffect(() => { if (profile) { setDisplayName(profile.displayName); setHandle(profile.handle); } }, [profile]);
  const save = async () => { if (!onSave) return; setSaving(true); setError(undefined); try { await onSave({ display_name: displayName, handle }); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSaving(false); } };
  return <Dialog open={open} title="User profile" description="This is how agents see you in new messages." onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving || loading || !profile} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button></>}>
    <div className={styles.profileForm}>{loadError && <Alert tone="error">{loadError}</Alert>}{loading && !profile ? <p>Loading profile…</p> : <><label><span>Display name</span><Input aria-label="Display name" maxLength={120} value={displayName} onChange={event => setDisplayName(event.target.value)} /></label><label><span>Handle</span><div className={styles.handleInput}><i>@</i><Input aria-label="User handle" maxLength={80} value={handle} onChange={event => setHandle(event.target.value.replace(/^@/, ''))} /></div></label><small>Name and handle are stored as a snapshot in each message; old messages do not change when you rename the profile.</small>{error && <Alert tone="error">{error}</Alert>}</>}</div>
  </Dialog>;
}
