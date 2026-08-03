// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAttachment } from '@agenvyl/contracts';
import { WorkspaceContent } from './WorkspaceContent';

afterEach(cleanup);

const image = (name: string): WorkspaceAttachment => ({
  version_id: `version-${name}`,
  entry_id: `entry-${name}`,
  path: `images/${name}`,
  name,
  size: 10,
  mime_type: 'image/png',
  url: `/versions/${name}`,
  preview_url: `/versions/${name}/preview`,
});

describe('Workspace image viewer', () => {
  it('opens a fitted image gallery with zoom controls and restores focus on close', async () => {
    const user = userEvent.setup();
    const first = image('first.png');
    const second = image('second.png');
    const onNavigate = vi.fn();
    render(<WorkspaceContent attachment={first} mode="rendered" gallery={[first, second]} onGalleryNavigate={onNavigate} />);

    const opener = screen.getByRole('button', { name: /Open image “first.png”/ });
    expect(document.activeElement).not.toBe(opener);
    expect(screen.getByRole('img', { name: 'first.png' })).toBeTruthy();

    await user.click(opener);
    expect(await screen.findByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Next image' }));
    await waitFor(() => expect(screen.getByText('2 of 2')).toBeTruthy());
    expect(screen.getByText('second.png')).toBeTruthy();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
