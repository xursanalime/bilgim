import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

import { BackupCodes } from './backup-codes';

const CODES = ['aaaa-1111', 'bbbb-2222', 'cccc-3333', 'dddd-4444'];

describe('BackupCodes', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders every backup code', () => {
    render(<BackupCodes codes={CODES} />);
    for (const code of CODES) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
  });

  it('copies all codes to the clipboard joined by newlines', async () => {
    render(<BackupCodes codes={CODES} />);
    await userEvent.click(screen.getByRole('button', { name: /nusxalash/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      CODES.join('\n'),
    );
  });

  it('gates the acknowledge action behind the confirmation checkbox', async () => {
    const onAcknowledge = jest.fn();
    render(<BackupCodes codes={CODES} onAcknowledge={onAcknowledge} />);

    const done = screen.getByRole('button', { name: /tayyor/i });
    expect(done).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox'));
    expect(done).toBeEnabled();

    await userEvent.click(done);
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('has no automated a11y violations (axe smoke test)', async () => {
    const { container } = render(<BackupCodes codes={CODES} onAcknowledge={jest.fn()} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
