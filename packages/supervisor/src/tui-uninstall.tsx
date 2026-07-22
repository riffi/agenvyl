import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from './messages.js';
import type { Locale } from './preferences.js';
import { BusyView, TuiFrame } from './tui-chrome.js';

export type UninstallRequest = { purge: boolean; confirmed: boolean };

export const UninstallScreen = ({ locale, onBack, onConfirm }: { locale: Locale; onBack: () => void; onConfirm: (request: UninstallRequest) => void }) => {
  const [mode, setMode] = useState<0 | 1>(0);
  const [confirm, setConfirm] = useState('');
  useInput((input, key) => {
    if (key.escape) { onBack(); return; }
    if (key.upArrow || key.downArrow) { setMode(value => value === 0 ? 1 : 0); setConfirm(''); return; }
    if (mode === 0 && key.return) { onConfirm({ purge: false, confirmed: true }); return; }
    if (mode !== 1) return;
    if (key.backspace || key.delete) setConfirm(value => value.slice(0, -1));
    else if (key.return && confirm === 'DELETE') onConfirm({ purge: true, confirmed: true });
    else if (input && !key.ctrl && !key.meta) setConfirm(value => `${value}${input}`.slice(0, 16));
  });
  return <TuiFrame locale={locale}>
    <Text bold>{t(locale, 'uninstall')}</Text>
    <Box marginTop={1} flexDirection="column">
      <Text bold={mode === 0} color={mode === 0 ? 'cyan' : undefined}>{mode === 0 ? '◆ ' : '  '}{t(locale, 'removeApp')}</Text>
      <Text bold={mode === 1} color={mode === 1 ? 'red' : undefined}>{mode === 1 ? '◆ ' : '  '}{t(locale, 'removeAll')}</Text>
    </Box>
    {mode === 1 && <Box marginTop={1}><Text>{t(locale, 'typeDelete')} <Text color="red">{confirm}_</Text></Text></Box>}
    <Box marginTop={1}><Text dimColor>{t(locale, 'uninstallKeys')}</Text></Box>
  </TuiFrame>;
};

export const UninstallingScreen = ({ locale }: { locale: Locale }) => <BusyView locale={locale} label={t(locale, 'uninstalling')} />;

export const UninstalledScreen = ({ locale, purge, scheduled, onExit }: { locale: Locale; purge: boolean; scheduled: boolean; onExit: () => void }) => {
  useInput((input, key) => { if (input.toLowerCase() === 'q' || key.return || key.escape) onExit(); });
  return <TuiFrame locale={locale}>
    <Text bold color="green">✓  {t(locale, 'uninstalled')}</Text>
    <Box marginTop={1} flexDirection="column">
      <Text>{t(locale, purge ? 'dataRemoved' : 'dataPreserved')}</Text>
      {scheduled && <Text dimColor>{t(locale, 'removalScheduled')}</Text>}
    </Box>
    <Box marginTop={1}><Text dimColor>{t(locale, 'closeHint')}</Text></Box>
  </TuiFrame>;
};
