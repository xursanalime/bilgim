import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PaymentStateBanner } from './payment-state-banner';

describe('PaymentStateBanner', () => {
  it('renders the failed variant with a retry action', async () => {
    const onRetry = jest.fn();
    render(
      <PaymentStateBanner variant="failed" locale="uz" onRetry={onRetry} />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('To‘lov amalga oshmadi')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the required variant and shows the amount', () => {
    render(
      <PaymentStateBanner
        variant="required"
        locale="uz"
        amountUzs={150000}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText(/kutilmoqda/i)).toBeInTheDocument();
    expect(screen.getByText(/150.?000 so'm/)).toBeInTheDocument();
  });

  it('omits the action button when no onRetry is provided', () => {
    render(<PaymentStateBanner variant="failed" locale="uz" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
