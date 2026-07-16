import { render, screen } from '@testing-library/react';

// The `Skeleton` primitive is consolidated by task 0.3 into
// `components/ui/skeleton`. Provide a virtual mock so this suite runs
// independently of that parallel work.
jest.mock(
  '../ui/skeleton',
  () => ({
    Skeleton: ({ className }: { className?: string }) => (
      <div data-testid="skeleton" className={className} />
    ),
  }),
  { virtual: true },
);

import { LoadingState } from './loading-state';

describe('LoadingState', () => {
  it('renders an accessible busy status region with a label', () => {
    render(<LoadingState label="Loading lessons" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading lessons')).toBeInTheDocument();
  });

  it('renders skeleton placeholders for the list variant', () => {
    render(<LoadingState variant="list" count={3} />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it.each(['list', 'card', 'table', 'page'] as const)(
    'renders the %s variant without crashing',
    (variant) => {
      render(<LoadingState variant={variant} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    },
  );

  it('clamps count to at least one unit', () => {
    render(<LoadingState variant="card" count={0} />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });
});
