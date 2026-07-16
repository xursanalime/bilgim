import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ErrorState } from './error-state';

describe('ErrorState', () => {
  it('renders as an alert with the title and message', () => {
    render(
      <ErrorState
        title="Could not load lessons"
        message="Please check your connection."
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Could not load lessons')).toBeInTheDocument();
    expect(screen.getByText('Please check your connection.')).toBeInTheDocument();
  });

  it('renders a retry button wired to onRetry', async () => {
    const onRetry = jest.fn();
    render(
      <ErrorState
        title="Failed"
        retryLabel="Retry"
        onRetry={onRetry}
      />,
    );

    const retry = screen.getByRole('button', { name: 'Retry' });
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button when no onRetry is provided', () => {
    render(<ErrorState title="Failed" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
