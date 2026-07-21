import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('one-line installer contracts', () => {
  it('keeps the POSIX installer checksum-first, rollback-capable, and privilege-free', async () => {
    const script = await readFile(new URL('../packaging/install.sh', import.meta.url), 'utf8');
    expect(script).toContain("--proto '=https'");
    expect(script).toContain('Archive checksum mismatch.');
    expect(script).toContain('agenvyl" init --locale en --shortcuts recommended --path');
    expect(script).toContain('the previous installation was restored');
    expect(script).not.toMatch(/\bsudo\b/u);
  });

  it('keeps the PowerShell installer checksum-first, rollback-capable, and user-scoped', async () => {
    const script = await readFile(new URL('../packaging/install.ps1', import.meta.url), 'utf8');
    expect(script).toContain('[Security.Cryptography.SHA256]::Create()');
    expect(script).toContain("Release archive URL must use HTTPS");
    expect(script).toContain("Join-Path $env:LOCALAPPDATA 'Agenvyl\\versions'");
    expect(script).toContain("System32\\tar.exe");
    expect(script).toContain('the previous installation was restored');
    expect(script).not.toMatch(/Start-Process.+-Verb\s+RunAs/u);
  });
});
