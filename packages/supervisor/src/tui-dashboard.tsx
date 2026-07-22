import { Box, Text, useInput } from 'ink';
import { Spinner } from '@inkjs/ui';
import { t, type MessageKey } from './messages.js';
import type { Locale } from './preferences.js';
import { StateLine, TuiFrame } from './tui-chrome.js';

export type DashboardAction = { id: string; label: MessageKey; enabled: boolean };

export const DashboardView = ({ locale, installed, stateLabel, actions, index, busy, message, technical, showTechnical, columns = 80, rows = 24, onMove, onSelect, onDetails, onExit }: { locale: Locale; installed: boolean; stateLabel: MessageKey; actions: DashboardAction[]; index: number; busy: boolean; message: string; technical: string; showTechnical: boolean; columns?: number; rows?: number; onMove: (delta: number) => void; onSelect: () => void; onDetails: () => void; onExit: () => void }) => {
  useInput((input, key) => {
    if (busy) return;
    if (input.toLowerCase() === 'q' || key.escape) onExit();
    else if (input.toLowerCase() === 'd') onDetails();
    else if (key.upArrow) onMove(-1);
    else if (key.downArrow) onMove(1);
    else if (key.return) onSelect();
  });
  const compact = columns < 60 || rows < 18;
  return <TuiFrame locale={locale}>
    <StateLine locale={locale} stateLabel={stateLabel} installed={installed} />
    <Box marginTop={1} flexDirection="column">{actions.map((action, actionIndex) => {
      const selected = actionIndex === index;
      return <Text key={action.id} dimColor={!action.enabled} bold={selected && action.enabled} color={selected ? 'cyan' : undefined}>{selected ? '◆ ' : '  '}{t(locale, action.label)}</Text>;
    })}</Box>
    <Box marginTop={1}>{busy ? <Spinner type="dots" label={message || t(locale, 'working')} /> : <Text color={message ? 'green' : undefined}>{message}</Text>}</Box>
    {!compact && <Text dimColor>{t(locale, 'keys')}</Text>}
    {showTechnical && technical && <Box marginTop={1} borderStyle="round" flexDirection="column"><Text bold>{t(locale, 'details')}</Text><Text wrap="truncate-end">{technical}</Text></Box>}
  </TuiFrame>;
};

export const availableDashboardActions = (installed: boolean, status: { running: boolean; stale: boolean; failed?: boolean }): DashboardAction[] => [
  ...(!installed ? [{ id: 'install', label: 'setupAndLaunch' as const, enabled: !status.running }] : []),
  ...(installed && (status.stale || status.failed) ? [{ id: 'install', label: 'repair' as const, enabled: !status.running }] : []),
  { id: 'start', label: 'start', enabled: installed && !status.running && !status.failed },
  { id: 'open', label: 'open', enabled: status.running },
  { id: 'stop', label: 'stop', enabled: status.running || status.stale || status.failed === true },
  { id: 'connectors', label: 'connectors', enabled: status.running },
  { id: 'doctor', label: 'doctor', enabled: true },
  { id: 'logs', label: 'logs', enabled: installed },
  { id: 'backup', label: 'backup', enabled: status.running },
  { id: 'restore', label: 'restore', enabled: installed && !status.running },
  { id: 'language', label: 'language', enabled: true },
  { id: 'uninstall', label: 'uninstall', enabled: installed },
  { id: 'exit', label: 'exit', enabled: true },
];
