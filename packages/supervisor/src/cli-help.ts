import { createRequire } from 'node:module';

type CliOption = {
  syntax: string;
  description: string;
};

type CliCommand = {
  name: string;
  usage: string;
  summary: string;
  description: string;
  options?: CliOption[];
  notes?: string[];
};

const jsonOption: CliOption = { syntax: '--json', description: 'Print structured JSON output.' };

export const cliCommands: readonly CliCommand[] = [
  {
    name: 'tui',
    usage: 'agenvyl tui',
    summary: 'Open the interactive terminal control center.',
    description: 'Requires an interactive terminal. Running agenvyl without a command does the same in a terminal.',
  },
  {
    name: 'init',
    usage: 'agenvyl init [options]',
    summary: 'Initialize a portable installation.',
    description: 'Validates the bundle, prepares the local runtime, and optionally installs shortcuts and the user command.',
    options: [
      { syntax: '--locale <ru|en>', description: 'Set the control-center language.' },
      { syntax: '--shortcuts <none|recommended|all>', description: 'Choose which shortcuts to install. Default: recommended.' },
      { syntax: '--path <none|user>', description: 'Install the stable agenvyl command for the user. Default: none.' },
      jsonOption,
    ],
  },
  {
    name: 'repair',
    usage: 'agenvyl repair [options]',
    summary: 'Repair the portable installation and command integration.',
    description: 'Revalidates application files, rebuilds local runtime configuration, and preserves user data.',
    options: [
      { syntax: '--locale <ru|en>', description: 'Set the control-center language.' },
      { syntax: '--shortcuts <none|recommended|all>', description: 'Choose which shortcuts to repair. Default: recommended.' },
      { syntax: '--path <none|user>', description: 'Repair the stable user command. Default: user.' },
      jsonOption,
    ],
  },
  {
    name: 'setup',
    usage: 'agenvyl setup [options]',
    summary: 'Start Agenvyl and configure detected connectors.',
    description: 'Selects safe detected connectors during first setup, then opens the relevant Web UI settings page.',
    options: [
      { syntax: '--all', description: 'Select all safe detected connectors without prompting.' },
      { syntax: '--no-open', description: 'Do not open the browser.' },
    ],
  },
  {
    name: 'start',
    usage: 'agenvyl start [--json]',
    summary: 'Start the local Agenvyl runtime.',
    description: 'Starts PostgreSQL, Connector, and Core without opening a browser.',
    options: [jsonOption],
  },
  {
    name: 'stop',
    usage: 'agenvyl stop [--json]',
    summary: 'Stop the local Agenvyl runtime.',
    description: 'Stops Core, Connector, and managed PostgreSQL and cleans stale runtime state.',
    options: [jsonOption],
  },
  {
    name: 'status',
    usage: 'agenvyl status [--json]',
    summary: 'Show whether the local runtime is running.',
    description: 'Suitable for scripts. Exits with code 3 when Agenvyl is stopped or has stale runtime state.',
    options: [jsonOption],
  },
  {
    name: 'logs',
    usage: 'agenvyl logs [component] [--lines <count>]',
    summary: 'Print recent component logs.',
    description: 'The component is supervisor by default. Output is plain text.',
    options: [
      { syntax: '--lines <1..10000>', description: 'Number of recent lines to print. Default: 100.' },
    ],
    notes: ['Components: supervisor, postgresql, connector, core.'],
  },
  {
    name: 'doctor',
    usage: 'agenvyl doctor [--json]',
    summary: 'Run installation and runtime diagnostics.',
    description: 'Checks settings, bundled executables, configured ports, and runtime port ownership. Exits with code 2 when a check fails.',
    options: [jsonOption],
  },
  {
    name: 'backup',
    usage: 'agenvyl backup [file] [--json]',
    summary: 'Create a PostgreSQL database dump.',
    description: 'Uses the backups directory and a timestamped filename unless a destination file is supplied.',
    options: [jsonOption],
    notes: ['The managed Agenvyl runtime must be running. Workspace files are not included.'],
  },
  {
    name: 'restore',
    usage: 'agenvyl restore <file> [--json]',
    summary: 'Replace the managed database from a dump.',
    description: 'Restores a PostgreSQL custom-format dump into the managed database.',
    options: [jsonOption],
    notes: ['Stop Agenvyl before restoring. Workspace files must be restored separately.'],
  },
  {
    name: 'uninstall',
    usage: 'agenvyl uninstall [--purge --yes] [--json]',
    summary: 'Remove the portable application.',
    description: 'Preserves personal data by default. Full removal requires both --purge and --yes.',
    options: [
      { syntax: '--purge', description: 'Also remove Agenvyl configuration and personal data.' },
      { syntax: '--yes', description: 'Confirm the destructive --purge operation.' },
      jsonOption,
    ],
  },
];

const require = createRequire(import.meta.url);
const packageMetadata = require('../package.json') as { version: string };

export const agenvylVersion = packageMetadata.version;

export type CliMetaAction =
  | { type: 'help'; topic?: string }
  | { type: 'version' };

export const resolveCliMetaAction = (values: string[]): CliMetaAction | undefined => {
  if (values.length === 1 && ['--version', '-V', 'version'].includes(values[0])) return { type: 'version' };
  if (values.length === 0) return undefined;
  if (values[0] === 'help') return { type: 'help', ...(values[1] ? { topic: values[1] } : {}) };
  if (values[0] === '--help' || values[0] === '-h') return { type: 'help' };
  if (values.slice(1).some(value => value === '--help' || value === '-h')) return { type: 'help', topic: values[0] };
  return undefined;
};

export const renderGeneralHelp = () => {
  const commandWidth = Math.max(...cliCommands.map(command => command.name.length));
  const commands = cliCommands
    .map(command => `  ${command.name.padEnd(commandWidth)}  ${command.summary}`)
    .join('\n');

  return `Agenvyl ${agenvylVersion}
Control the local Agenvyl runtime.

Usage:
  agenvyl
  agenvyl <command> [options]
  agenvyl help [command]

Running agenvyl without a command opens the terminal control center when the
input and output are interactive. In scripts and redirected sessions it runs
agenvyl status instead.

Commands:
${commands}

Global options:
  -h, --help     Show general or command-specific help.
  -V, --version  Show the Agenvyl version.

Run "agenvyl help <command>" for command details.
User guide: https://github.com/riffi/agenvyl/blob/main/docs/user-guide/cli-and-control-center.md
`;
};

export const renderCommandHelp = (name: string) => {
  const command = cliCommands.find(candidate => candidate.name === name);
  if (!command) return undefined;

  const sections = [
    `${command.summary}\n\nUsage:\n  ${command.usage}\n\n${command.description}`,
  ];
  if (command.options?.length) sections.push(`Options:\n${renderOptions(command.options)}`);
  if (command.notes?.length) sections.push(`Notes:\n${command.notes.map(note => `  ${note}`).join('\n')}`);
  sections.push('Global options:\n  -h, --help  Show this help.');
  return `${sections.join('\n\n')}\n`;
};

export const commandNames = () => cliCommands.map(command => command.name);

const renderOptions = (options: CliOption[]) => {
  const width = Math.max(...options.map(option => option.syntax.length));
  return options.map(option => `  ${option.syntax.padEnd(width)}  ${option.description}`).join('\n');
};
