// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../../entities/run';
import { MarkdownAnswer } from './Timeline';

afterEach(cleanup);

const run: Run = {
  id: 'run',
  messageId: 'message',
  agent: 'agent',
  harnessInstanceId: 'local-codex',
  harnessType: 'codex',
  modelId: 'codex',
  executionProfile: { workflowMode: 'work', requestedReasoningEffort: null, reasoningEffort: null, reasoningEffortFallback: false, reasoningEffortSource: 'auto', planEnforcement: null, permissionProfileId: null, agentVariantId: null },
  status: 'completed',
  text: '',
  tools: [],
  interventions: [],
};

describe('agent answer code blocks', () => {
  it('copies fenced code without adding a control to inline code', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(<MarkdownAnswer text={'Use `inline` here.\n\n```ts\nconst answer = 42;\n```'} run={run} />);

    const copyButton = screen.getByRole('button', { name: 'Copy code block' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.click(copyButton);

    expect(writeText).toHaveBeenCalledWith('const answer = 42;');
    expect(screen.getByRole('button', { name: 'Code copied' })).toBeTruthy();
    expect(screen.getByText('Copied')).toBeTruthy();
  });

  it('keeps the copy action usable when clipboard access fails', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });

    render(<MarkdownAnswer text={'```\necho hello\n```'} run={run} />);
    await user.click(screen.getByRole('button', { name: 'Copy code block' }));

    expect(screen.getByRole('button', { name: 'Copy failed, try again' })).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
