import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './dialog';

function Example() {
  return (
    <Dialog>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Manage your settings.</DialogDescription>
        <button type="button">Inside action</button>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog component', () => {
  it('opens on trigger and exposes a labelled modal dialog', async () => {
    render(<Example />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Open'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // Radix labels the dialog via the title for screen readers.
    expect(dialog).toHaveAccessibleName('Settings');
  });

  it('moves focus into the dialog (focus trap entry)', async () => {
    render(<Example />);
    await userEvent.click(screen.getByText('Open'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it('closes on Escape', async () => {
    render(<Example />);
    await userEvent.click(screen.getByText('Open'));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('has no automated a11y violations while open (axe smoke test)', async () => {
    render(<Example />);
    await userEvent.click(screen.getByText('Open'));
    await screen.findByRole('dialog');
    const results = await axe(document.body);
    expect(results).toHaveNoViolations();
  });
});
