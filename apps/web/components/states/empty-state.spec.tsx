import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(
      <EmptyState
        title="No lessons yet"
        description="Create your first lesson to get started."
      />,
    );
    expect(screen.getByText('No lessons yet')).toBeInTheDocument();
    expect(
      screen.getByText('Create your first lesson to get started.'),
    ).toBeInTheDocument();
  });

  it('renders a primary CTA and calls onClick when pressed', async () => {
    const onClick = jest.fn();
    render(
      <EmptyState
        title="No lessons yet"
        action={{ label: 'Create lesson', onClick }}
      />,
    );

    const cta = screen.getByRole('button', { name: 'Create lesson' });
    await userEvent.click(cta);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not render a CTA when no action is provided', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a decorative icon', () => {
    render(
      <EmptyState
        title="Empty"
        icon={<span data-testid="empty-icon" />}
      />,
    );
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
  });
});
