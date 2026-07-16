import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from './Button';

describe('Button component', () => {
  it('renders correctly with label', async () => {
    const { getByText } = await render(<Button label="Press Me" />);
    expect(getByText('Press Me')).toBeTruthy();
  });

  it('calls onPress when pressed', async () => {
    const onPressMock = jest.fn();
    const { getByText } = await render(<Button label="Press Me" onPress={onPressMock} />);

    fireEvent.press(getByText('Press Me'));
    expect(onPressMock).toHaveBeenCalledTimes(1);
  });

  it('shows ActivityIndicator when loading', async () => {
    const { getByRole, queryByText } = await render(<Button label="Press Me" loading />);

    // The label should be hidden when loading
    expect(queryByText('Press Me')).toBeNull();
    // Accessibility state should be busy
    expect(getByRole('button').props.accessibilityState.busy).toBe(true);
  });

  it('is disabled when the disabled prop is true', async () => {
    const onPressMock = jest.fn();
    const { getByRole, getByText } = await render(
      <Button label="Press Me" onPress={onPressMock} disabled />
    );

    const button = getByRole('button');
    expect(button.props.accessibilityState.disabled).toBe(true);

    fireEvent.press(getByText('Press Me'));
    expect(onPressMock).not.toHaveBeenCalled();
  });

  it('is disabled when loading is true', async () => {
    const onPressMock = jest.fn();
    const { getByRole } = await render(
      <Button label="Press Me" onPress={onPressMock} loading />
    );

    const button = getByRole('button');
    expect(button.props.accessibilityState.disabled).toBe(true);
  });
});
