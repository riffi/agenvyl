import type { Locale } from './preferences.js';

const catalog = {
  en: {
    title: 'Agenvyl control center', installed: 'Installed', notInstalled: 'Not installed', running: 'Running', stopped: 'Stopped', starting: 'Starting', attention: 'Needs attention',
    install: 'Install / repair', start: 'Start', open: 'Open Web UI', stop: 'Stop', connectors: 'Configure connectors', doctor: 'Diagnostics', logs: 'Logs', backup: 'Backup', restore: 'Restore', language: 'Language', uninstall: 'Uninstall', exit: 'Exit',
    keys: '↑/↓ navigate  Enter select  D details  Q exit', working: 'Working…', details: 'Technical details', ready: 'Operation completed.', selectLocale: 'Choose language / Выберите язык',
  },
  ru: {
    title: 'Центр управления Agenvyl', installed: 'Установлен', notInstalled: 'Не установлен', running: 'Работает', stopped: 'Остановлен', starting: 'Запускается', attention: 'Требует внимания',
    install: 'Установить / восстановить', start: 'Запустить', open: 'Открыть Web UI', stop: 'Остановить', connectors: 'Настроить коннекторы', doctor: 'Диагностика', logs: 'Логи', backup: 'Резервная копия', restore: 'Восстановление', language: 'Язык', uninstall: 'Удалить', exit: 'Выход',
    keys: '↑/↓ навигация  Enter выбрать  D подробности  Q выход', working: 'Выполняется…', details: 'Технические подробности', ready: 'Операция завершена.', selectLocale: 'Выберите язык / Choose language',
  },
} as const;

export type MessageKey = keyof typeof catalog.en;
export function t(locale: Locale, key: MessageKey): string { return catalog[locale][key]; }
