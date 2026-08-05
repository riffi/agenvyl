import { describe, expect, it } from 'vitest';
import { agenvylVersion, commandNames, renderCommandHelp, renderGeneralHelp, resolveCliMetaAction } from './cli-help.js';

describe('supervisor CLI help', () => {
  it('lists every public command in general help', () => {
    const help = renderGeneralHelp();

    for (const command of commandNames()) expect(help).toContain(`  ${command}`);
    expect(help).toContain('agenvyl help [command]');
    expect(help).not.toContain('daemon');
  });

  it('renders command-specific usage, options, and safety notes', () => {
    expect(renderCommandHelp('logs')).toContain('agenvyl logs [component] [--lines <count>]');
    expect(renderCommandHelp('logs')).toContain('supervisor, postgresql, connector, core');
    expect(renderCommandHelp('restore')).toContain('Stop Agenvyl before restoring.');
    expect(renderCommandHelp('uninstall')).toContain('both --purge and --yes');
  });

  it('rejects unknown help topics and reads the package version', () => {
    expect(renderCommandHelp('unknown')).toBeUndefined();
    expect(agenvylVersion).toMatch(/^\d+\.\d+\.\d+/u);
  });

  it('recognizes every supported help and version invocation', () => {
    expect(resolveCliMetaAction(['--help'])).toEqual({ type: 'help' });
    expect(resolveCliMetaAction(['help'])).toEqual({ type: 'help' });
    expect(resolveCliMetaAction(['help', 'logs'])).toEqual({ type: 'help', topic: 'logs' });
    expect(resolveCliMetaAction(['logs', '--help'])).toEqual({ type: 'help', topic: 'logs' });
    expect(resolveCliMetaAction(['logs', '-h'])).toEqual({ type: 'help', topic: 'logs' });
    expect(resolveCliMetaAction(['--version'])).toEqual({ type: 'version' });
    expect(resolveCliMetaAction(['-V'])).toEqual({ type: 'version' });
    expect(resolveCliMetaAction([])).toBeUndefined();
    expect(resolveCliMetaAction(['status'])).toBeUndefined();
  });
});
