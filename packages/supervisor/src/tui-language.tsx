import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from './messages.js';
import type { Locale } from './preferences.js';
import { Spinner } from '@inkjs/ui';
import { TuiFrame } from './tui-chrome.js';

const languages: { id: Locale; label: string }[] = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' },
];

export const LanguageScreen = ({ locale, onBack, onSelect }: { locale: Locale; onBack: () => void; onSelect: (locale: Locale) => void | Promise<void> }) => {
  const [index, setIndex] = useState(() => languages.findIndex(language => language.id === locale));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const selectLanguage = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try { await onSelect(languages[index].id); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  useInput((input, key) => {
    if (busy) return;
    if (key.escape || input.toLowerCase() === 'q') { onBack(); return; }
    if (key.upArrow) { setIndex(value => (value - 1 + languages.length) % languages.length); return; }
    if (key.downArrow) { setIndex(value => (value + 1) % languages.length); return; }
    if (key.return) void selectLanguage();
  });

  return <TuiFrame locale={locale}>
    <Text bold>{t(locale, 'selectLanguage')}</Text>
    <Box marginTop={1} flexDirection="column">
      {languages.map((language, languageIndex) => <Text key={language.id} color={languageIndex === index ? 'cyan' : undefined}>{languageIndex === index ? '› ' : '  '}{language.label}{language.id === locale ? ' · ✓' : ''}</Text>)}
    </Box>
    <Box marginTop={1}><Text dimColor>{t(locale, 'languageKeys')}</Text></Box>
    {busy && <Spinner type="dots" label={t(locale, 'working')} />}
    {message && <Text color="red">{message}</Text>}
  </TuiFrame>;
};
