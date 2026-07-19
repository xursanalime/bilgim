import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';

describe('Button component', () => {
  it('renders children correctly', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('handles click events', async () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    
    await userEvent.click(screen.getByText('Click me'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('shows loading state and disables the button', () => {
    render(<Button loading>Submit</Button>);
    
    expect(screen.getByText('Iltimos kuting...')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
    // Original children should not be present (it replaces them)
    expect(screen.queryByText('Submit')).not.toBeInTheDocument();
  });

  it('is disabled when the disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders icons when provided', () => {
    const LeftIcon = <span data-testid="left-icon" />;
    const RightIcon = <span data-testid="right-icon" />;
    
    render(
      <Button leftIcon={LeftIcon} rightIcon={RightIcon}>
        With Icons
      </Button>
    );

    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    expect(screen.getByText('With Icons')).toBeInTheDocument();
  });

  it('applies variant and size classes', () => {
    const { rerender } = render(<Button variant="danger" size="lg">Danger Large</Button>);
    let button = screen.getByRole('button');
    
    expect(button).toHaveClass('bg-red');
    expect(button).toHaveClass('px-7');

    rerender(<Button variant="ghost" size="sm">Ghost Small</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('text-ink-soft');
    expect(button).toHaveClass('px-4');
  });

  it('applies fullWidth class', () => {
    render(<Button fullWidth>Full Width</Button>);
    expect(screen.getByRole('button')).toHaveClass('w-full');
  });
});
