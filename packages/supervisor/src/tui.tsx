import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupervisorConfig } from './config.js';
import { openWebUi } from './browser.js';
import { initializePortable, isPortableInitialized } from './initialization.js';
import { t, type MessageKey } from './messages.js';
import { defaultLocale, loadSettings, saveSettings, type Locale } from './preferences.js';
import { backupDatabase, doctor, getSupervisorStatus, readLogs, restoreDatabase, startSupervisor, stopSupervisor } from './runtime.js';
import { configureConnectors, getSetupState, mergeConnectorSelection, type HarnessType, type SetupState } from './setup.js';
import { uninstallPortable } from './uninstall.js';

type UninstallRequest = { purge: boolean; confirmed: boolean };
type Screen = 'dashboard' | 'connectors' | 'uninstall';
export type DashboardAction = { id: string; label: MessageKey; enabled: boolean };

export async function runTui(config: SupervisorConfig, cliPath: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The TUI requires an interactive terminal. Use agenvyl status for scripts.');
  let uninstallRequest: UninstallRequest | undefined;
  const app = render(<ControlCenter config={config} cliPath={cliPath} onUninstall={request => { uninstallRequest = request; }} />, { exitOnCtrlC: true });
  await app.waitUntilExit();
  return uninstallRequest ? uninstallPortable(config, uninstallRequest) : undefined;
}

function ControlCenter({ config, cliPath, onUninstall }: { config: SupervisorConfig; cliPath: string; onUninstall: (request: UninstallRequest) => void }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [locale, setLocale] = useState<Locale>();
  const [needsLocale, setNeedsLocale] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getSupervisorStatus>>>({ running: false, stale: false, health: {} });
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [technical, setTechnical] = useState('');
  const [showTechnical, setShowTechnical] = useState(false);

  const refresh = useCallback(async () => {
    const [settings, installation, runtime] = await Promise.all([loadSettings(config), isPortableInitialized(config), getSupervisorStatus(config)]);
    setLocale(current => current ?? settings?.locale ?? defaultLocale());
    setNeedsLocale(settings === undefined);
    setInstalled(installation);
    setStatus(runtime);
  }, [config]);
  useEffect(() => { void refresh().catch(error => setTechnical(errorMessage(error))); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => { void refresh().catch(() => undefined); }, 2000); return () => clearInterval(timer); }, [refresh]);

  const actions = useMemo(() => availableDashboardActions(installed, status), [installed, status]);

  const perform = useCallback(async (action: DashboardAction) => {
    if (!action.enabled || busy || !locale) return;
    if (action.id === 'exit') { exit(); return; }
    if (action.id === 'connectors') { setScreen('connectors'); return; }
    if (action.id === 'uninstall') { setScreen('uninstall'); return; }
    setBusy(true); setMessage(''); setTechnical('');
    try {
      if (action.id === 'install') {
        const result = await initializePortable(config, { locale, shortcuts: 'recommended' });
        setNeedsLocale(false); setMessage(`${t(locale, 'ready')} ${result.shortcuts.join(', ')}`);
      } else if (action.id === 'start') {
        await startSupervisor(config, cliPath, process.env, stage => setMessage(locale === 'ru' ? ({ preparing: 'Проверяем установку…', launching: 'Запускаем компоненты…', waiting: 'Ожидаем готовности…', ready: 'Agenvyl готов.' } as const)[stage] : ({ preparing: 'Checking installation…', launching: 'Starting components…', waiting: 'Waiting for readiness…', ready: 'Agenvyl is ready.' } as const)[stage])); openWebUi(config); setMessage(t(locale, 'ready'));
      } else if (action.id === 'open') { openWebUi(config); }
      else if (action.id === 'stop') { await stopSupervisor(config); setMessage(t(locale, 'ready')); }
      else if (action.id === 'doctor') {
        const result = await doctor(config); setMessage(result.ok ? t(locale, 'ready') : t(locale, 'attention')); setTechnical(result.checks.map(check => `${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}`).join('\n'));
      } else if (action.id === 'logs') { setTechnical(await readLogs(config, 'supervisor', 25) || 'No logs yet.'); setShowTechnical(true); }
      else if (action.id === 'backup') { const path = await backupDatabase(config); setMessage(`${t(locale, 'ready')} ${path}`); }
      else if (action.id === 'restore') {
        const files = (await readdir(config.paths.backups)).filter(file => file.endsWith('.dump')).sort();
        const latest = files.at(-1); if (!latest) throw new Error('No backup is available.');
        await restoreDatabase(config, join(config.paths.backups, latest)); setMessage(`${t(locale, 'ready')} ${latest}`);
      } else if (action.id === 'language') {
        const next: Locale = locale === 'ru' ? 'en' : 'ru'; const settings = await loadSettings(config);
        if (settings) await saveSettings(config, { ...settings, locale: next });
        setLocale(next); setNeedsLocale(false);
      }
      await refresh();
    } catch (error) { setMessage(t(locale, 'attention')); setTechnical(errorMessage(error)); setShowTechnical(true); }
    finally { setBusy(false); }
  }, [busy, cliPath, config, exit, locale, refresh]);

  useInput(input => {
    if (!locale || screen !== 'dashboard' || busy || !needsLocale) return;
    if (needsLocale) {
      const selected = input === '1' || input.toLowerCase() === 'r' ? 'ru' : input === '2' || input.toLowerCase() === 'e' ? 'en' : undefined;
      if (selected) {
        setLocale(selected); setNeedsLocale(false);
        void saveSettings(config, { schemaVersion: 2, locale: selected, initializedAt: new Date().toISOString(), shortcuts: [] }).catch(error => setTechnical(errorMessage(error)));
      }
      return;
    }
  });

  if (!locale) return <Text>{t(defaultLocale(), 'working')}</Text>;
  if (needsLocale) return <Box flexDirection="column" padding={1}><Text bold>{t(locale, 'selectLocale')}</Text><Text>1. Русский</Text><Text>2. English</Text></Box>;
  if (screen === 'connectors') return <ConnectorScreen config={config} locale={locale} onBack={() => { setScreen('dashboard'); void refresh(); }} />;
  if (screen === 'uninstall') return <UninstallScreen locale={locale} onBack={() => setScreen('dashboard')} onConfirm={request => { onUninstall(request); exit(); }} />;

  const unhealthy = Object.values(status.health).some(value => value === 'not_ready');
  const stateLabel: MessageKey = status.running ? (unhealthy ? 'attention' : 'running') : status.state?.phase === 'starting' ? 'starting' : status.stale || status.state?.phase === 'failed' ? 'attention' : installed ? 'stopped' : 'notInstalled';
  return <DashboardView locale={locale} installed={installed} stateLabel={stateLabel} actions={actions} index={index} busy={busy} message={message} technical={technical} showTechnical={showTechnical} columns={stdout?.columns ?? 80} rows={stdout?.rows ?? 24} onMove={delta => setIndex(value => (value + delta + actions.length) % actions.length)} onSelect={() => { void perform(actions[index]); }} onDetails={() => setShowTechnical(value => !value)} onExit={exit} />;
}

export function DashboardView({ locale, installed, stateLabel, actions, index, busy, message, technical, showTechnical, columns = 80, rows = 24, onMove, onSelect, onDetails, onExit }: { locale: Locale; installed: boolean; stateLabel: MessageKey; actions: DashboardAction[]; index: number; busy: boolean; message: string; technical: string; showTechnical: boolean; columns?: number; rows?: number; onMove: (delta: number) => void; onSelect: () => void; onDetails: () => void; onExit: () => void }) {
  useInput((input, key) => {
    if (busy) return;
    if (input.toLowerCase() === 'q' || key.escape) onExit();
    else if (input.toLowerCase() === 'd') onDetails();
    else if (key.upArrow) onMove(-1);
    else if (key.downArrow) onMove(1);
    else if (key.return) onSelect();
  });
  const compact = columns < 60 || rows < 18;
  return <Box flexDirection="column" paddingX={1}>
    <Text bold color="cyan">{t(locale, 'title')}</Text>
    <Text>{t(locale, stateLabel)}{installed ? ` · ${t(locale, 'installed')}` : ''}</Text>
    <Box marginTop={1} flexDirection="column">{actions.map((action, actionIndex) => <Text key={action.id} dimColor={!action.enabled} color={actionIndex === index ? 'cyan' : undefined}>{actionIndex === index ? '› ' : '  '}{t(locale, action.label)}</Text>)}</Box>
    <Box marginTop={1}><Text color={busy ? 'yellow' : undefined}>{busy ? t(locale, 'working') : message}</Text></Box>
    {!compact && <Text dimColor>{t(locale, 'keys')}</Text>}
    {showTechnical && technical && <Box marginTop={1} borderStyle="round" flexDirection="column"><Text bold>{t(locale, 'details')}</Text><Text wrap="truncate-end">{technical}</Text></Box>}
  </Box>;
}

export function availableDashboardActions(installed: boolean, status: { running: boolean; stale: boolean }): DashboardAction[] {
  return [
    { id: 'install', label: 'install', enabled: !status.running },
    { id: 'start', label: 'start', enabled: installed && !status.running },
    { id: 'open', label: 'open', enabled: status.running },
    { id: 'stop', label: 'stop', enabled: status.running || status.stale },
    { id: 'connectors', label: 'connectors', enabled: status.running },
    { id: 'doctor', label: 'doctor', enabled: true },
    { id: 'logs', label: 'logs', enabled: installed },
    { id: 'backup', label: 'backup', enabled: status.running },
    { id: 'restore', label: 'restore', enabled: installed && !status.running },
    { id: 'language', label: 'language', enabled: true },
    { id: 'uninstall', label: 'uninstall', enabled: installed && !status.running },
    { id: 'exit', label: 'exit', enabled: true },
  ];
}

function ConnectorScreen({ config, locale, onBack }: { config: SupervisorConfig; locale: Locale; onBack: () => void }) {
  const [state, setState] = useState<SetupState>(); const [selected, setSelected] = useState<HarnessType[]>([]); const [index, setIndex] = useState(0); const [confirm, setConfirm] = useState(''); const [agyPending, setAgyPending] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { void getSetupState(config).then(value => { setState(value); setSelected(value.instances.filter(item => item.status !== 'unavailable').map(item => item.type).filter((item): item is HarnessType => ['hermes', 'opencode', 'antigravity'].includes(item))); }).catch(error => setMessage(errorMessage(error))); }, [config]);
  useInput((input, key) => {
    if (!state) { if (key.escape) onBack(); return; }
    if (agyPending) {
      if (key.escape) { setAgyPending(false); setConfirm(''); return; }
      if (key.backspace || key.delete) setConfirm(value => value.slice(0, -1));
      else if (key.return) { if (confirm === 'AGY') { setSelected(value => [...new Set<HarnessType>([...value, 'antigravity'])]); setAgyPending(false); setConfirm(''); } else setMessage('Type exactly AGY / Введите точно AGY'); }
      else if (input && !key.ctrl && !key.meta) setConfirm(value => `${value}${input}`.slice(0, 16));
      return;
    }
    if (key.escape || input.toLowerCase() === 'q') { onBack(); return; }
    if (key.upArrow) setIndex(value => (value - 1 + state.candidates.length) % state.candidates.length);
    if (key.downArrow) setIndex(value => (value + 1) % state.candidates.length);
    if (input === ' ') {
      const candidate = state.candidates[index]; if (!candidate?.safeToSelect) return;
      if (candidate.type === 'antigravity' && !selected.includes(candidate.type)) { setAgyPending(true); return; }
      setSelected(value => value.includes(candidate.type) ? value.filter(item => item !== candidate.type) : [...value, candidate.type]);
    }
    if (key.return) void configureConnectors(config, mergeConnectorSelection(state, selected, selected.includes('antigravity'))).then(() => { setMessage(t(locale, 'ready')); return getSetupState(config); }).then(setState).catch(error => setMessage(errorMessage(error)));
  });
  if (!state) return <Text>{message || t(locale, 'working')}</Text>;
  if (agyPending) return <Box flexDirection="column" padding={1}><Text bold>AGY может изменять файлы. Режим по умолчанию: plan.</Text><Text>Для включения введите точно AGY и нажмите Enter:</Text><Text color="yellow">{confirm}_</Text><Text dimColor>Esc — отмена</Text></Box>;
  return <Box flexDirection="column" padding={1}><Text bold>{t(locale, 'connectors')}</Text>{state.candidates.map((candidate, candidateIndex) => <Text key={candidate.type} dimColor={!candidate.safeToSelect} color={candidateIndex === index ? 'cyan' : undefined}>{candidateIndex === index ? '› ' : '  '}[{selected.includes(candidate.type) ? 'x' : ' '}] {candidate.type === 'antigravity' ? 'AGY' : candidate.label} — {candidate.safeToSelect ? candidate.cli.version ?? (candidate.endpoint?.reachable ? 'ready' : 'found') : 'not found'}</Text>)}<Text dimColor>↑/↓ · Space toggle · Enter save · Esc back</Text><Text color="yellow">{message}</Text></Box>;
}

function UninstallScreen({ locale, onBack, onConfirm }: { locale: Locale; onBack: () => void; onConfirm: (request: UninstallRequest) => void }) {
  const [mode, setMode] = useState<0 | 1>(0); const [confirm, setConfirm] = useState('');
  useInput((input, key) => {
    if (key.escape) { onBack(); return; }
    if (key.upArrow || key.downArrow) { setMode(value => value === 0 ? 1 : 0); setConfirm(''); return; }
    if (mode === 0 && key.return) onConfirm({ purge: false, confirmed: true });
    else if (mode === 1) {
      if (key.backspace || key.delete) setConfirm(value => value.slice(0, -1));
      else if (key.return && confirm === 'DELETE') onConfirm({ purge: true, confirmed: true });
      else if (input && !key.ctrl && !key.meta) setConfirm(value => `${value}${input}`.slice(0, 16));
    }
  });
  return <Box flexDirection="column" padding={1}><Text bold>{t(locale, 'uninstall')}</Text><Text color={mode === 0 ? 'cyan' : undefined}>{mode === 0 ? '› ' : '  '}Remove application, preserve user data</Text><Text color={mode === 1 ? 'red' : undefined}>{mode === 1 ? '› ' : '  '}Remove application and all user data</Text>{mode === 1 && <Text>Type DELETE to confirm: <Text color="red">{confirm}_</Text></Text>}<Text dimColor>↑/↓ choose · Enter confirm · Esc back</Text></Box>;
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
