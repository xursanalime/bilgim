/**
 * Button — primary action component for the mobile app.
 *
 * Variants:
 *   - "primary"   accent green background, ink foreground (CTA)
 *   - "secondary" ink-surface background, cream foreground
 *   - "ghost"     transparent background, accent foreground (text link)
 *   - "danger"    red destructive action (logout, delete)
 *
 * Sizes: "sm" | "md" | "lg" — defaults to "md".
 *
 * The component shows a spinner when `loading` is true and disables the
 * onPress handler. It supports the same a11y semantics as a native
 * <Pressable>, including a focus/pressed visual state.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
  TextStyle,
} from 'react-native';

import { colors, radius, spacing, typography } from '../../theme/colors';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  testID?: string;
}

const HEIGHT: Record<ButtonSize, number> = {
  sm: 36,
  md: 48,
  lg: 56,
};

const PADDING_H: Record<ButtonSize, number> = {
  sm: spacing.md,
  md: spacing.lg,
  lg: spacing.xl,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  fullWidth,
  style,
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const variantStyles = VARIANTS[variant];

  return (
    <Pressable
      testID={testID}
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: PADDING_H[size],
          backgroundColor: variantStyles.background,
          borderColor: variantStyles.border,
          borderWidth: variantStyles.border ? 1 : 0,
          opacity: isDisabled ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
          width: fullWidth ? '100%' : undefined,
        },
        variant === 'primary' && !isDisabled && styles.primaryShadow,
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles.foreground} />
      ) : (
        <Text style={[styles.text, { color: variantStyles.foreground }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

interface VariantStyle {
  background: string;
  foreground: string;
  border?: string;
}

const VARIANTS: Record<ButtonVariant, VariantStyle> = {
  primary: {
    background: colors.accent,
    foreground: colors.accentForeground,
  },
  secondary: {
    background: colors.inkSurface,
    foreground: colors.cream,
    border: colors.inkLine,
  },
  ghost: {
    background: 'transparent',
    foreground: colors.accent,
  },
  danger: {
    background: colors.danger,
    foreground: colors.ink,
  },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  primaryShadow: {
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  text: {
    ...typography.bodyStrong,
  } as TextStyle,
});

export default Button;
