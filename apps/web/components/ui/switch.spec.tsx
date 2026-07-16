import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { Switch } from './switch';

describe('Switch component', () => {
  it('exposes the switch role with aria-checked', () => {
    render(<Switch checked aria-label="Notifications" />);
    const sw = screen.getByRole('switch', { name: 'Notifications' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('is operable with the keyboard (Space toggles)', async () => {
    const onCheckedChange = jest.fn();
    function Controlled() {
      const [on, setOn] = useState(false);
      return (
        <Switch
          checked={on}
          onCheckedChange={(v) => {
            setOn(v);
            onCheckedChange(v);
          }}
          aria-label="Toggle"
        />
      );
    }
    render(<Controlled />);
    const sw = screen.getByRole('switch');
    sw.focus();
    expect(sw).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('does not toggle when disabled', async () => {
    const onCheckedChange = jest.fn();
    render(<Switch disabled onCheckedChange={onCheckedChange} aria-label="Toggle" />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
