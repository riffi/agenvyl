import type { Locale } from './preferences.js';

const catalog = {
  en: {
    title: 'Agenvyl control center', control: 'CONTROL', installed: 'Installed', notInstalled: 'Not installed', running: 'Running', stopped: 'Stopped', starting: 'Starting', attention: 'Needs attention',
    install: 'Install / repair', setupAndLaunch: 'Set up and launch', repair: 'Repair and restart', start: 'Start', open: 'Open Web UI', stop: 'Stop', connectors: 'Configure connectors', doctor: 'Diagnostics', logs: 'Logs', backup: 'Backup', restore: 'Restore', language: 'Language', uninstall: 'Uninstall', exit: 'Exit',
    keys: '↑/↓ navigate  Enter select  D details  Q exit', working: 'Working…', details: 'Technical details', ready: 'Operation completed.', selectLocale: 'Choose language / Выберите язык',
    selectLanguage: 'Choose language', languageKeys: '↑/↓ navigate  Enter select  Esc back',
    uninstalling: 'Uninstalling Agenvyl…', uninstallStopping: 'Stopping Agenvyl…', uninstallRemoving: 'Removing application files…', uninstallScheduling: 'Scheduling final cleanup…', uninstallFailed: 'Agenvyl could not be uninstalled.', uninstallStopFailed: 'Agenvyl could not be stopped, so removal did not begin.', serviceWillStop: 'Agenvyl is running and will be stopped automatically before removal.', uninstallErrorKeys: 'R retry  D details  Esc back', uninstalled: 'Agenvyl has been uninstalled.', dataPreserved: 'Your rooms and personal data were preserved.', dataRemoved: 'Application and personal data were removed.', removalScheduled: 'Application files will be removed after this window closes.', closeHint: 'Enter or Q to close',
    removeApp: 'Remove application, preserve user data', removeAll: 'Remove application and all user data', typeDelete: 'Type DELETE to confirm:', uninstallKeys: '↑/↓ choose  Enter confirm  Esc back',
  },
  ru: {
    title: 'Центр управления Agenvyl', control: 'УПРАВЛЕНИЕ', installed: 'Установлен', notInstalled: 'Не установлен', running: 'Работает', stopped: 'Остановлен', starting: 'Запускается', attention: 'Требует внимания',
    install: 'Установить / восстановить', setupAndLaunch: 'Настроить и запустить', repair: 'Восстановить и перезапустить', start: 'Запустить', open: 'Открыть Web UI', stop: 'Остановить', connectors: 'Настроить коннекторы', doctor: 'Диагностика', logs: 'Логи', backup: 'Резервная копия', restore: 'Восстановление', language: 'Язык', uninstall: 'Удалить', exit: 'Выход',
    keys: '↑/↓ навигация  Enter выбрать  D подробности  Q выход', working: 'Выполняется…', details: 'Технические подробности', ready: 'Операция завершена.', selectLocale: 'Выберите язык / Choose language',
    selectLanguage: 'Выбор языка', languageKeys: '↑/↓ навигация  Enter выбрать  Esc назад',
    uninstalling: 'Деинсталляция Agenvyl…', uninstallStopping: 'Останавливаем Agenvyl…', uninstallRemoving: 'Удаляем файлы приложения…', uninstallScheduling: 'Планируем финальную очистку…', uninstallFailed: 'Не удалось удалить Agenvyl.', uninstallStopFailed: 'Не удалось остановить Agenvyl, поэтому удаление не началось.', serviceWillStop: 'Agenvyl сейчас работает и будет автоматически остановлен перед удалением.', uninstallErrorKeys: 'R повторить  D подробности  Esc назад', uninstalled: 'Agenvyl деинсталлирован.', dataPreserved: 'Ваши комнаты и личные данные сохранены.', dataRemoved: 'Приложение и личные данные удалены.', removalScheduled: 'Файлы приложения будут удалены после закрытия этого окна.', closeHint: 'Enter или Q — закрыть',
    removeApp: 'Удалить приложение, сохранить данные', removeAll: 'Удалить приложение и все данные', typeDelete: 'Для подтверждения введите DELETE:', uninstallKeys: '↑/↓ выбор  Enter подтвердить  Esc назад',
  },
} as const;

export type MessageKey = keyof typeof catalog.en;
export function t(locale: Locale, key: MessageKey): string { return catalog[locale][key]; }
