import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {Sidebar,RenameRoomDialog,TrashDialog,UserProfileDialog} from './Sidebar';

const sidebarProps={
  open:false,close:vi.fn(),view:'chat' as const,openPersonas:vi.fn(),rooms:[],selectedRoomId:'',selectRoom:vi.fn(),createRoom:vi.fn(),renameRoom:vi.fn(),deleteRoom:vi.fn(),
};

describe('collapsible sidebar',()=>{
  it('renders the compact navigation with named icon controls',()=>{
    const html=renderToStaticMarkup(<Sidebar {...sidebarProps} collapsed toggleCollapsed={vi.fn()} openProjects={vi.fn()}/>);
    expect(html).toContain('aria-label="Expand sidebar"');
    expect(html).toContain('aria-label="New room"');
    expect(html).toContain('aria-label="Search rooms"');
    expect(html).toContain('aria-label="Agents"');
    expect(html).toContain('aria-label="Projects"');
    expect(html).not.toContain('aria-label="Room history"');
  });

  it('renders a collapse control and room history when expanded',()=>{
    const html=renderToStaticMarkup(<Sidebar {...sidebarProps} toggleCollapsed={vi.fn()}/>);
    expect(html).toContain('aria-label="Collapse sidebar"');
    expect(html).toContain('aria-label="Room history"');
    expect(html).toContain('src="/agenvyl-logo-on-dark.svg"');
    expect(html).toContain('>genvyl</strong>');
    expect(html).not.toContain('>agenvyl</strong>');
  });
});

describe('user profile settings',()=>{
  it('renders loaded identity fields and explains agent-facing semantics',()=>{
    const html=renderToStaticMarkup(<UserProfileDialog open profile={{id:'local-user',displayName:'Владимир',handle:'vladimir',createdAt:'2026-01-01',updatedAt:'2026-01-01'}} onClose={vi.fn()} onSave={vi.fn()}/>);
    expect(html).toContain('This is how agents see you in new messages.');
    expect(html).toContain('value="Владимир"');expect(html).toContain('value="vladimir"');
    expect(html).toContain('old messages do not change when you rename the profile');
    expect(html).toContain('Save');
  });

  it('renders loading and load-error states without enabling save',()=>{
    const html=renderToStaticMarkup(<UserProfileDialog open loading loadError="Профиль недоступен" onClose={vi.fn()} onSave={vi.fn()}/>);
    expect(html).toContain('Профиль недоступен');expect(html).toContain('Loading profile…');expect(html).toContain('disabled=""');
  });
});

describe('room management dialogs',()=>{
  it('renders the current room name in the rename form',()=>{
    const html=renderToStaticMarkup(<RenameRoomDialog room={{id:'room-1',title:'Проект',created_at:'2026-01-01',participant_count:2,last_message_at:null,last_message_text:null,workflow_mode:'work'}} onClose={vi.fn()} onRename={vi.fn()}/>);
    expect(html).toContain('Rename room');
    expect(html).toContain('value="Проект"');
  });

  it('renders deleted rooms and both recovery actions',()=>{
    const html=renderToStaticMarkup(<TrashDialog rooms={[{id:'room-1',title:'Удалённая комната',created_at:'2026-01-01',participant_count:2,last_message_at:null,last_message_text:null,workflow_mode:'work',deleted_at:'2026-07-20'}]} onClose={vi.fn()} restoreRoom={vi.fn()} purgeRoom={vi.fn()}/>);
    expect(html).toContain('Удалённая комната');
    expect(html).toContain('Restore room');
    expect(html).toContain('Permanently');
  });
});
