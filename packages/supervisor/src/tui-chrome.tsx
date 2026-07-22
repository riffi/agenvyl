import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { t, type MessageKey } from './messages.js';
import type { Locale } from './preferences.js';

export const TuiFrame = ({ locale, children }: { locale: Locale; children: ReactNode }) => <Box flexDirection="column" paddingX={1}>
  <Box alignSelf="flex-start" borderStyle="round" borderColor="cyan" paddingX={1}>
    <Text bold color="cyan">◆ AGENVYL</Text>
    <Text dimColor>  {t(locale, 'control')}</Text>
  </Box>
  <Box flexDirection="column" marginTop={1}>{children}</Box>
</Box>;

export const BusyView = ({ locale, label }: { locale: Locale; label: string }) => <TuiFrame locale={locale}>
  <Spinner type="dots" label={label} />
</TuiFrame>;

export const StateLine = ({ locale, stateLabel, installed }: { locale: Locale; stateLabel: MessageKey; installed: boolean }) => {
  const color = stateLabel === 'running' ? 'green' : stateLabel === 'attention' ? 'red' : stateLabel === 'starting' ? 'yellow' : 'gray';
  const marker = stateLabel === 'running' ? '●' : stateLabel === 'attention' ? '▲' : '○';
  return <Text><Text color={color}>{marker}</Text>  {t(locale, stateLabel)}{installed ? <Text dimColor>  ·  {t(locale, 'installed')}</Text> : null}</Text>;
};
