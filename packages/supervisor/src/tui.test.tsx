import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { availableDashboardActions, DashboardView, type DashboardAction } from './tui.js';

const actions: DashboardAction[] = [{ id: 'start', label: 'start', enabled: true }, { id: 'exit', label: 'exit', enabled: true }];

describe('dashboard presentation', () => {
  it('renders localized RU and EN states', () => {
    const ru = render(<DashboardView locale="ru" installed stateLabel="stopped" actions={actions} index={0} busy={false} message="" technical="" showTechnical={false} onMove={() => undefined} onSelect={() => undefined} onDetails={() => undefined} onExit={() => undefined} />);
    expect(ru.lastFrame()).toContain('Центр управления Agenvyl'); expect(ru.lastFrame()).toContain('Остановлен'); ru.unmount();
    const en = render(<DashboardView locale="en" installed={false} stateLabel="notInstalled" actions={actions} index={0} busy={false} message="" technical="" showTechnical={false} onMove={() => undefined} onSelect={() => undefined} onDetails={() => undefined} onExit={() => undefined} />);
    expect(en.lastFrame()).toContain('Agenvyl control center'); expect(en.lastFrame()).toContain('Not installed'); en.unmount();
  });

  it('handles keyboard navigation, selection, details and small terminals', () => {
    const onMove = vi.fn(), onSelect = vi.fn(), onDetails = vi.fn();
    const view = render(<DashboardView locale="en" installed stateLabel="running" actions={actions} index={0} busy={false} message="" technical="pid=42" showTechnical columns={40} rows={10} onMove={onMove} onSelect={onSelect} onDetails={onDetails} onExit={() => undefined} />);
    view.stdin.write('\u001B[B'); view.stdin.write('\r'); view.stdin.write('d');
    expect(onMove).toHaveBeenCalledWith(1); expect(onSelect).toHaveBeenCalled(); expect(onDetails).toHaveBeenCalled(); expect(view.lastFrame()).not.toContain('navigate');
  });

  it('exposes only lifecycle actions that are safe in the current state', () => {
    const stopped = availableDashboardActions(true, { running: false, stale: false });
    expect(stopped.find(action => action.id === 'start')?.enabled).toBe(true);
    expect(stopped.find(action => action.id === 'connectors')?.enabled).toBe(false);
    const running = availableDashboardActions(true, { running: true, stale: false });
    expect(running.find(action => action.id === 'start')?.enabled).toBe(false);
    expect(running.find(action => action.id === 'stop')?.enabled).toBe(true);
  });
});
