import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { availableDashboardActions, DashboardView, type DashboardAction } from './tui.js';
import { LanguageScreen } from './tui-language.js';
import { UninstalledScreen } from './tui-uninstall.js';

const actions: DashboardAction[] = [{ id: 'start', label: 'start', enabled: true }, { id: 'exit', label: 'exit', enabled: true }];

describe('dashboard presentation', () => {
  it('renders localized RU and EN states', () => {
    const ru = render(<DashboardView locale="ru" installed stateLabel="stopped" actions={actions} index={0} busy={false} message="" technical="" showTechnical={false} onMove={() => undefined} onSelect={() => undefined} onDetails={() => undefined} onExit={() => undefined} />);
    expect(ru.lastFrame()).toContain('◆ AGENVYL'); expect(ru.lastFrame()).toContain('Остановлен'); ru.unmount();
    const en = render(<DashboardView locale="en" installed={false} stateLabel="notInstalled" actions={actions} index={0} busy={false} message="" technical="" showTechnical={false} onMove={() => undefined} onSelect={() => undefined} onDetails={() => undefined} onExit={() => undefined} />);
    expect(en.lastFrame()).toContain('◆ AGENVYL'); expect(en.lastFrame()).toContain('Not installed'); en.unmount();
  });

  it('handles keyboard navigation, selection, details and small terminals', () => {
    const onMove = vi.fn(), onSelect = vi.fn(), onDetails = vi.fn();
    const view = render(<DashboardView locale="en" installed stateLabel="running" actions={actions} index={0} busy={false} message="" technical="pid=42" showTechnical columns={40} rows={10} onMove={onMove} onSelect={onSelect} onDetails={onDetails} onExit={() => undefined} />);
    view.stdin.write('\u001B[B'); view.stdin.write('\r'); view.stdin.write('d');
    expect(onMove).toHaveBeenCalledWith(1); expect(onSelect).toHaveBeenCalled(); expect(onDetails).toHaveBeenCalled(); expect(view.lastFrame()).not.toContain('navigate');
  });

  it('exposes only lifecycle actions that are safe in the current state', () => {
    const stopped = availableDashboardActions(true, { running: false, stale: false });
    expect(stopped.find(action => action.id === 'install')).toBeUndefined();
    expect(stopped.find(action => action.id === 'start')?.enabled).toBe(true);
    expect(stopped.find(action => action.id === 'connectors')?.enabled).toBe(false);
    const running = availableDashboardActions(true, { running: true, stale: false });
    expect(running.find(action => action.id === 'start')?.enabled).toBe(false);
    expect(running.find(action => action.id === 'stop')?.enabled).toBe(true);
    const fresh = availableDashboardActions(false, { running: false, stale: false });
    expect(fresh[0]).toMatchObject({ id: 'install', label: 'setupAndLaunch', enabled: true });
    const failed = availableDashboardActions(true, { running: false, stale: false, failed: true });
    expect(failed[0]).toMatchObject({ id: 'install', label: 'repair', enabled: true });
    expect(failed.find(action => action.id === 'start')?.enabled).toBe(false);
  });
});

describe('uninstall completion', () => {
  it('confirms uninstall and explains preserved data', () => {
    const onExit = vi.fn();
    const view = render(<UninstalledScreen locale="ru" purge={false} scheduled onExit={onExit} />);
    expect(view.lastFrame()).toContain('Agenvyl деинсталлирован.');
    expect(view.lastFrame()).toContain('данные сохранены');
    view.stdin.write('\r');
    expect(onExit).toHaveBeenCalled();
  });
});

describe('language selection', () => {
  it('opens with the current locale selected and confirms another locale', async () => {
    const onSelect = vi.fn();
    const view = render(<LanguageScreen locale="ru" onBack={() => undefined} onSelect={onSelect} />);
    expect(view.lastFrame()).toContain('› Русский · ✓');
    view.stdin.write('\u001B[B');
    await new Promise(resolve => setTimeout(resolve, 10));
    view.stdin.write('\r');
    expect(onSelect).toHaveBeenCalledWith('en');
  });

  it('returns without changing the locale', () => {
    const onBack = vi.fn();
    const view = render(<LanguageScreen locale="en" onBack={onBack} onSelect={() => undefined} />);
    view.stdin.write('q');
    expect(onBack).toHaveBeenCalled();
  });
});
