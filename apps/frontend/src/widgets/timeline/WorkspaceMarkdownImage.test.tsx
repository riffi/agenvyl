// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceAttachment } from '@agenvyl/contracts';
import type { Run } from '../../entities/run';
import { MarkdownAnswer } from './Timeline';

afterEach(cleanup);

const run = (value: Partial<Run> = {}): Run => ({
  id: 'run',
  messageId: 'message',
  agent: 'agent',
  harnessInstanceId: 'local-hermes',
  harnessType: 'hermes',
  modelId: 'sol',
  modeId: null,
  status: 'streaming',
  text: '',
  tools: [],
  ...value,
});

const attachment = (name: string): WorkspaceAttachment => ({
  version_id: `version-${name}`,
  entry_id: `entry-${name}`,
  path: `charts/${name}`,
  name,
  size: 10,
  mime_type: 'image/png',
  url: `/version-${name}`,
  preview_url: `/version-${name}/preview`,
});

describe('workspace images in agent markdown', () => {
  it('shows a placeholder while the response streams', () => {
    const html = renderToStaticMarkup(<MarkdownAnswer text="![Chart](workspace:charts/result.png)" run={run()} />);
    expect(html).toContain('The image will appear');
    expect(html).not.toContain('/preview');
  });

  it('renders an accessible preview button and caption after completion', () => {
    const result = attachment('result.png');
    const html = renderToStaticMarkup(<MarkdownAnswer
      text="![Performance](workspace:charts/result.png)"
      run={run({ status: 'completed', embeds: [{ kind: 'image', path: result.path, status: 'resolved', attachment: result }] })}
    />);

    expect(html).toContain('src="/version-result.png/preview"');
    expect(html).toContain('<button');
    expect(html).toContain('full-screen view');
    expect(html).not.toContain('target="_blank"');
    expect(html).toContain('<figcaption>Performance</figcaption>');
  });

  it('opens the selected image in answer order and restores focus after Escape', async () => {
    const user = userEvent.setup();
    const first = attachment('first.png');
    const second = attachment('second.png');
    render(<MarkdownAnswer
      text={'![Первое](workspace:charts/first.png)\n\nТекст между изображениями.\n\n![Второе](workspace:charts/second.png)'}
      run={run({
        status: 'completed',
        embeds: [
          { kind: 'image', path: first.path, status: 'resolved', attachment: first },
          { kind: 'image', path: second.path, status: 'resolved', attachment: second },
        ],
      })}
    />);

    const previews = screen.getAllByRole('button', { name: /full-screen view/ });
    await user.click(previews[1]);

    expect(await screen.findByText('second.png')).toBeTruthy();
    expect(screen.getByText('2 of 2')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(previews[1]));
  });

  it('excludes failed images from the lightbox gallery', async () => {
    const user = userEvent.setup();
    const result = attachment('result.png');
    render(<MarkdownAnswer
      text={'![Готово](workspace:charts/result.png)\n\n![Ошибка](workspace:charts/missing.png)'}
      run={run({
        status: 'completed',
        embeds: [
          { kind: 'image', path: result.path, status: 'resolved', attachment: result },
          { kind: 'image', path: 'charts/missing.png', status: 'error', error: 'not_found' },
        ],
      })}
    />);

    expect(screen.getByText(/file not found/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /full-screen view/ }));
    expect(await screen.findByText('1 of 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next image' }).hasAttribute('disabled')).toBe(true);
  });

  it('does not hotlink external Markdown images', () => {
    const html = renderToStaticMarkup(<MarkdownAnswer text="![Remote](https://example.com/wide.png)" run={run({ status: 'completed' })} />);
    expect(html).toContain('Image is not stored in the workspace');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('src="https://example.com/wide.png"');
  });

  it('renders a local error instead of failing the answer', () => {
    const html = renderToStaticMarkup(<MarkdownAnswer
      text="![Missing](workspace:missing.png)"
      run={run({ status: 'completed', embeds: [{ kind: 'image', path: 'missing.png', status: 'error', error: 'not_found' }] })}
    />);
    expect(html).toContain('Could not display image');
    expect(html).toContain('file not found');
  });
});
