#!/usr/bin/env node
import { useEffect, useMemo, useState } from 'react';
import { render, useApp, useStdout } from 'ink';
import { t } from './messages.js';
import type { Locale } from './preferences.js';
import { availableDashboardActions, DashboardView } from './tui-dashboard.js';
import { LanguageScreen } from './tui-language.js';
import { UninstalledScreen, UninstallingScreen, UninstallScreen } from './tui-uninstall.js';

type PreviewState = 'not-installed' | 'stopped' | 'running';

const PreviewDashboard = () => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [locale, setLocale] = useState<Locale>('ru');
  const [previewState, setPreviewState] = useState<PreviewState>('stopped');
  const [index, setIndex] = useState(0);
  const [message, setMessage] = useState('PREVIEW: все действия выполняются только в памяти.');
  const [showTechnical, setShowTechnical] = useState(false);
  const [screen, setScreen] = useState<'dashboard' | 'language' | 'uninstall' | 'uninstalling' | 'uninstalled'>('dashboard');
  const [busy, setBusy] = useState(false);
  const [purge, setPurge] = useState(false);
  const installed = previewState !== 'not-installed';
  const running = previewState === 'running';
  const actions = useMemo(() => availableDashboardActions(installed, { running, stale: false }), [installed, running]);
  useEffect(() => setIndex(value => Math.min(value, actions.length - 1)), [actions.length]);

  const selectAction = async () => {
    const action = actions[index];
    if (!action?.enabled) return;
    if (action.id === 'exit') { exit(); return; }
    if (action.id === 'language') { setScreen('language'); return; }
    if (action.id === 'uninstall') { setScreen('uninstall'); return; }
    setBusy(true);
    setMessage(`${t(locale, action.label)}…`);
    await new Promise(resolve => setTimeout(resolve, 700));
    if (action.id === 'install') setPreviewState('running');
    if (action.id === 'start') setPreviewState('running');
    if (action.id === 'stop') setPreviewState('stopped');
    setMessage(`PREVIEW: ${t(locale, action.label)} — без реального действия.`);
    setBusy(false);
  };

  if (screen === 'language') return <LanguageScreen locale={locale} onBack={() => setScreen('dashboard')} onSelect={selected => { setLocale(selected); setScreen('dashboard'); setMessage(`PREVIEW: ${t(selected, 'language')} — ${selected.toUpperCase()}.`); }} />;
  if (screen === 'uninstall') return <UninstallScreen locale={locale} onBack={() => setScreen('dashboard')} onConfirm={request => { setPurge(request.purge); setScreen('uninstalling'); setTimeout(() => setScreen('uninstalled'), 900); }} />;
  if (screen === 'uninstalling') return <UninstallingScreen locale={locale} />;
  if (screen === 'uninstalled') return <UninstalledScreen locale={locale} purge={purge} scheduled={process.platform === 'win32'} onExit={exit} />;

  return <DashboardView
    locale={locale}
    installed={installed}
    stateLabel={running ? 'running' : installed ? 'stopped' : 'notInstalled'}
    actions={actions}
    index={index}
    busy={busy}
    message={message}
    technical={'Mock supervisor log\nCore: ready\nConnector: ready\nDatabase: ready'}
    showTechnical={showTechnical}
    columns={stdout?.columns ?? 80}
    rows={stdout?.rows ?? 24}
    onMove={delta => setIndex(value => (value + delta + actions.length) % actions.length)}
    onSelect={() => { void selectAction(); }}
    onDetails={() => setShowTechnical(value => !value)}
    onExit={exit}
  />;
};

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write('The TUI preview requires an interactive terminal.\n');
  process.exitCode = 1;
} else {
  render(<PreviewDashboard />, { exitOnCtrlC: true });
}
