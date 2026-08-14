import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { conformanceBindings, formatConformanceReport, shippedHarnessTypes, validateConformanceBindings } from './bindings.js';
import { conformanceCaseIds } from './contract.js';

describe('shipped harness conformance bindings', () => {
  it('covers every shipped harness and mandatory contract case', () => {
    expect(validateConformanceBindings(conformanceBindings)).toEqual([]);
    expect(conformanceBindings.map(binding => binding.harness).sort()).toEqual([...shippedHarnessTypes].sort());
    for (const binding of conformanceBindings) expect(Object.keys(binding.cases).sort()).toEqual([...conformanceCaseIds].sort());
  });

  it('keeps pass evidence attached to an existing adapter test', async () => {
    for (const binding of conformanceBindings) {
      for (const disposition of Object.values(binding.cases)) {
        if (disposition.status !== 'pass') continue;
        const source = await readFile(resolve(disposition.evidence.file), 'utf8');
        expect(source, disposition.evidence.file).toContain(`it('${disposition.evidence.test}'`);
      }
    }
  });

  it('rejects empty waiver reasons instead of silently skipping a case', () => {
    const invalid = structuredClone(conformanceBindings) as unknown as typeof conformanceBindings;
    Object.assign(invalid[0]!.cases['replay-deduplicated'], { reason: '   ' });
    expect(validateConformanceBindings(invalid)).toContain('codex/replay-deduplicated: waiver reason is empty');
  });

  it('prints one searchable harness/case/waiver report', () => {
    const report = formatConformanceReport(conformanceBindings);
    for (const harness of shippedHarnessTypes) expect(report).toContain(`${harness} (`);
    for (const caseId of conformanceCaseIds) expect(report).toContain(caseId);
    process.stdout.write(`\nConnector conformance report\n${report}\n`);
  });
});
