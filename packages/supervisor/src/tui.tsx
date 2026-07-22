import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { Spinner } from '@inkjs/ui';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupervisorConfig } from './config.js';
import { openWebUi } from './browser.js';
import { initializePortable, isPortableInitialized } from './initialization.js';
import { t, type MessageKey } from './messages.js';
import { defaultLocale, loadSettings, saveSettings, type Locale } from './preferences.js';
import { backupDatabase, doctor, getSupervisorStatus, readLogs, restoreDatabase, startSupervisor, stopSupervisor } from './runtime.js';
import { configureConnectors, getSetupState, mergeConnectorSelection, type HarnessType, type SetupState } from './setup.js';
import { uninstallPortable, type UninstallStage } from './uninstall.js';
import { availableDashboardActions, DashboardView, type DashboardAction } from './tui-dashboard.js';
import { LanguageScreen } from './tui-language.js';
import { BusyView, TuiFrame } from './tui-chrome.js';
import { UninstallErrorScreen, UninstalledScreen, UninstallingScreen, UninstallScreen, type UninstallRequest } from './tui-uninstall.js';

type Screen = 'dashboard' | 'connectors' | 'language' | 'uninstall' | 'uninstalling' | 'uninstall-error' | 'uninstalled';
export { availableDashboardActions, DashboardView, type DashboardAction } from './tui-dashboard.js';

export async function runTui(config: SupervisorConfig, cliPath: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The TUI requires an interactive terminal. Use agenvyl status for scripts.');
  const app = render(<ControlCenter config={config} cliPath={cliPath} />, { exitOnCtrlC: true });
  await app.waitUntilExit();
}

function ControlCenter({ config, cliPath }: { config: SupervisorConfig; cliPath: string }) {
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
  const [uninstallResult, setUninstallResult] = useState<{ purge: boolean; scheduled: boolean }>();
  const [uninstallRequest, setUninstallRequest] = useState<UninstallRequest>();
  const [uninstallStage, setUninstallStage] = useState<UninstallStage>('stopping');
  const [uninstallFailedStage, setUninstallFailedStage] = useState<UninstallStage>();

  const refresh = useCallback(async () => {
    const [settings, installation, runtime] = await Promise.all([loadSettings(config), isPortableInitialized(config), getSupervisorStatus(config)]);
    setLocale(current => current ?? settings?.locale ?? defaultLocale());
    setNeedsLocale(settings === undefined);
    setInstalled(installation);
    setStatus(runtime);
  }, [config]);
  useEffect(() => { void refresh().catch(error => setTechnical(errorMessage(error))); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => { void refresh().catch(() => undefined); }, 2000); return () => clearInterval(timer); }, [refresh]);

  const actions = useMemo(() => availableDashboardActions(installed, { running: status.running, stale: status.stale, failed: status.state?.phase === 'failed' }), [installed, status]);
  useEffect(() => setIndex(value => Math.min(value, actions.length - 1)), [actions.length]);

  const perform = useCallback(async (action: DashboardAction) => {
    if (!action.enabled || busy || !locale) return;
    if (action.id === 'exit') { exit(); return; }
    if (action.id === 'connectors') { setScreen('connectors'); return; }
    if (action.id === 'language') { setScreen('language'); return; }
    if (action.id === 'uninstall') { setScreen('uninstall'); return; }
    setBusy(true); setMessage(`${t(locale, action.label)}…`); setTechnical('');
    try {
      if (action.id === 'install') {
        if (status.state && !status.stale) await stopSupervisor(config);
        await initializePortable(config, { locale, shortcuts: 'recommended' });
        setNeedsLocale(false);
        await startSupervisor(config, cliPath, process.env, stage => setMessage(startProgress(locale, stage)));
        openWebUi(config, '/setup'); setMessage(t(locale, 'ready'));
      } else if (action.id === 'start') {
        await startSupervisor(config, cliPath, process.env, stage => setMessage(startProgress(locale, stage))); openWebUi(config); setMessage(t(locale, 'ready'));
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
      }
      await refresh();
    } catch (error) { setMessage(t(locale, 'attention')); setTechnical(errorMessage(error)); setShowTechnical(true); }
    finally { setBusy(false); }
  }, [busy, cliPath, config, exit, locale, refresh, status]);

  const performUninstall = useCallback(async (request: UninstallRequest) => {
    if (!locale) return;
    setUninstallRequest(request);
    let currentStage: UninstallStage | undefined;
    setUninstallStage('stopping'); setUninstallFailedStage(undefined);
    setScreen('uninstalling');
    try {
      const result = await uninstallPortable(config, request, stage => { currentStage = stage; setUninstallStage(stage); });
      setUninstallResult({ purge: result.purge, scheduled: result.scheduled });
      setScreen('uninstalled');
    } catch (error) {
      setTechnical(errorMessage(error)); setShowTechnical(false); setUninstallFailedStage(currentStage); setScreen('uninstall-error');
    }
  }, [config, locale]);

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

  if (!locale) return <BusyView locale={defaultLocale()} label={t(defaultLocale(), 'working')} />;
  if (needsLocale) return <TuiFrame locale={locale}><Text bold>{t(locale, 'selectLocale')}</Text><Text>1. Русский</Text><Text>2. English</Text></TuiFrame>;
  if (screen === 'connectors') return <ConnectorScreen config={config} locale={locale} onBack={() => { setScreen('dashboard'); void refresh(); }} />;
  if (screen === 'language') return <LanguageScreen locale={locale} onBack={() => setScreen('dashboard')} onSelect={async selected => {
    const settings = await loadSettings(config);
    await saveSettings(config, settings ? { ...settings, locale: selected } : { schemaVersion: 2, locale: selected, initializedAt: new Date().toISOString(), shortcuts: [] });
    setLocale(selected); setNeedsLocale(false); setScreen('dashboard'); setMessage(t(selected, 'ready'));
  }} />;
  if (screen === 'uninstall') return <UninstallScreen locale={locale} running={status.running} onBack={() => setScreen('dashboard')} onConfirm={request => { void performUninstall(request); }} />;
  if (screen === 'uninstalling') return <UninstallingScreen locale={locale} stage={uninstallStage} />;
  if (screen === 'uninstall-error' && uninstallRequest) return <UninstallErrorScreen locale={locale} failedStage={uninstallFailedStage} technical={technical} showTechnical={showTechnical} onRetry={() => { void performUninstall(uninstallRequest); }} onBack={() => setScreen('dashboard')} onDetails={() => setShowTechnical(value => !value)} />;
  if (screen === 'uninstalled' && uninstallResult) return <UninstalledScreen locale={locale} {...uninstallResult} onExit={exit} />;

  const unhealthy = Object.values(status.health).some(value => value === 'not_ready');
  const stateLabel: MessageKey = status.running ? (unhealthy ? 'attention' : 'running') : status.state?.phase === 'starting' ? 'starting' : status.stale || status.state?.phase === 'failed' ? 'attention' : installed ? 'stopped' : 'notInstalled';
  return <DashboardView locale={locale} installed={installed} stateLabel={stateLabel} actions={actions} index={index} busy={busy} message={message} technical={technical} showTechnical={showTechnical} columns={stdout?.columns ?? 80} rows={stdout?.rows ?? 24} onMove={delta => setIndex(value => (value + delta + actions.length) % actions.length)} onSelect={() => { void perform(actions[index]); }} onDetails={() => setShowTechnical(value => !value)} onExit={exit} />;
}

function ConnectorScreen({ config, locale, onBack }: { config: SupervisorConfig; locale: Locale; onBack: () => void }) {
  const [state, setState] = useState<SetupState>(); const [selected, setSelected] = useState<HarnessType[]>([]); const [index, setIndex] = useState(0); const [confirm, setConfirm] = useState(''); const [agyPending, setAgyPending] = useState(false); const [claudePending,setClaudePending]=useState(false); const [claudeConfirmed,setClaudeConfirmed]=useState(false); const [message, setMessage] = useState(''); const [saving, setSaving] = useState(false);
  useEffect(() => { void getSetupState(config).then(value => { setState(value); setSelected(value.instances.filter(item => item.status !== 'unavailable').map(item => item.type).filter((item): item is HarnessType => ['hermes', 'opencode', 'antigravity','codex','claude'].includes(item)));setClaudeConfirmed(value.instances.some(item=>item.type==='claude'&&item.allowSubscriptionOAuth)); }).catch(error => setMessage(errorMessage(error))); }, [config]);
  useInput((input, key) => {
    if (!state || saving) { if (key.escape && !saving) onBack(); return; }
    if (agyPending||claudePending) {
      if (key.escape) { setAgyPending(false);setClaudePending(false); setConfirm(''); return; }
      if (key.backspace || key.delete) setConfirm(value => value.slice(0, -1));
      else if (key.return) {const phrase=claudePending?'CLAUDE OAUTH':'AGY';if(confirm===phrase){const type:HarnessType=claudePending?'claude':'antigravity';setSelected(value=>[...new Set<HarnessType>([...value,type])]);if(claudePending)setClaudeConfirmed(true);setAgyPending(false);setClaudePending(false);setConfirm('');}else setMessage(`Type exactly ${phrase} / Введите точно ${phrase}`);}
      else if (input && !key.ctrl && !key.meta) setConfirm(value => `${value}${input}`.slice(0, 16));
      return;
    }
    if (key.escape || input.toLowerCase() === 'q') { onBack(); return; }
    if (key.upArrow) setIndex(value => (value - 1 + state.candidates.length) % state.candidates.length);
    if (key.downArrow) setIndex(value => (value + 1) % state.candidates.length);
    if (input === ' ') {
      const candidate = state.candidates[index]; if (!candidate?.safeToSelect) return;
      if (candidate.type === 'antigravity' && !selected.includes(candidate.type)) { setAgyPending(true); return; }
      if(candidate.requiresConfirmation==='claude_oauth'&&!selected.includes(candidate.type)&&!claudeConfirmed){setClaudePending(true);return;}
      setSelected(value => value.includes(candidate.type) ? value.filter(item => item !== candidate.type) : [...value, candidate.type]);
    }
    if (key.return) {
      setSaving(true); setMessage('');
      void configureConnectors(config, mergeConnectorSelection(state, selected, selected.includes('antigravity'),claudeConfirmed)).then(() => { setMessage(t(locale, 'ready')); return getSetupState(config); }).then(setState).catch(error => setMessage(errorMessage(error))).finally(() => setSaving(false));
    }
  });
  if (!state) return message ? <TuiFrame locale={locale}><Text color="red">{message}</Text><Text dimColor>Esc — back</Text></TuiFrame> : <BusyView locale={locale} label={t(locale, 'working')} />;
  if (agyPending) return <TuiFrame locale={locale}><Text bold>AGY может изменять файлы. Режим по умолчанию: plan.</Text><Text>Для включения введите точно AGY и нажмите Enter:</Text><Text color="yellow">{confirm}_</Text><Text dimColor>Esc — отмена</Text></TuiFrame>;
  if(claudePending)return <TuiFrame locale={locale}><Text bold>Claude subscription OAuth is experimental and may conflict with Anthropic terms for third-party products.</Text><Text>Для включения введите точно CLAUDE OAUTH и нажмите Enter:</Text><Text color="yellow">{confirm}_</Text><Text dimColor>Esc — отмена</Text></TuiFrame>;
  return <TuiFrame locale={locale}><Text bold>{t(locale, 'connectors')}</Text><Box marginTop={1} flexDirection="column">{state.candidates.map((candidate, candidateIndex) => <Text key={candidate.type} dimColor={!candidate.safeToSelect} bold={candidateIndex === index} color={candidateIndex === index ? 'cyan' : undefined}>{candidateIndex === index ? '◆ ' : '  '}[{selected.includes(candidate.type) ? 'x' : ' '}] {candidate.type === 'antigravity' ? 'AGY' : candidate.label} — {candidate.safeToSelect ? candidate.cli.version ?? (candidate.endpoint?.reachable ? 'ready' : 'found') : 'not found'}</Text>)}</Box><Box marginTop={1}>{saving ? <Spinner type="dots" label={t(locale, 'working')} /> : <Text color={message ? 'green' : undefined}>{message}</Text>}</Box><Text dimColor>↑/↓ · Space toggle · Enter save · Esc back</Text></TuiFrame>;
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }

const startProgress = (locale: Locale, stage: 'preparing' | 'launching' | 'waiting' | 'ready') => locale === 'ru'
  ? ({ preparing: 'Проверяем установку…', launching: 'Запускаем компоненты…', waiting: 'Ожидаем готовности…', ready: 'Agenvyl готов.' } as const)[stage]
  : ({ preparing: 'Checking installation…', launching: 'Starting components…', waiting: 'Waiting for readiness…', ready: 'Agenvyl is ready.' } as const)[stage];
