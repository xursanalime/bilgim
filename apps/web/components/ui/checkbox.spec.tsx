import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Checkbox } from './checkbox';

describe('Checkbox component', () => {
  it('renders an accessible native checkbox', () => {
    render(<Checkbox aria-label="Accept terms" />);
    expect(screen.getByRole('checkbox', { name: 'Accept terms' })).toBeInTheDocument();
  });

  it('toggles on click and reports change', async () => {
    const onChange = jest.fn();
    render(<Checkbox aria-label="Accept" onChange={onChange} />);
    const cb = screen.getByRole('checkbox');
    expect(cb).not.toBeChecked();
    await userEvent.click(cb);
    expect(cb).toBeChecked();
    expect(onChange).toHaveBeenCalled();
  });

  it('is keyboard operable with Space', async () => {
    render(<Checkbox aria-label="Accept" />);
    const cb = screen.getByRole('checkbox');
    cb.focus();
    expect(cb).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(cb).toBeChecked();
  });

  it('reflects the indeterminate state', () => {
    render(<Checkbox aria-label="Select all" indeterminate />);
    const cb = screen.getByRole<HTMLInputElement>('checkbox');
    expect(cb.indeterminate).toBe(true);
    expect(cb).toHaveAttribute('aria-checked', 'mixed');
  });

  it('cannot be toggled when disabled', async () => {
    render(<Checkbox aria-label="Accept" disabled />);
    const cb = screen.getByRole('checkbox');
    await userEvent.click(cb);
    expect(cb).not.toBeChecked();
  });
});
