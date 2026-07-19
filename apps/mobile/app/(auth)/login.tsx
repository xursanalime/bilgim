/**
 * Login screen — email + password.
 *
 * Uses react-hook-form + zod for client-side validation and calls
 * `useAuth().login()` which posts to `POST /api/v1/auth/login`. On success
 * the access + refresh tokens are persisted to expo-secure-store and the
 * root layout's auth guard redirects to /(tabs)/index.
 *
 * Backend error codes (`ACCOUNT_NOT_VERIFIED`, `UNAUTHENTICATED`, etc.) are
 * mapped to friendly Uzbek messages by `getAuthErrorMessage`.
 */

import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../lib/auth-context';
import { getAuthErrorMessage } from '../../lib/auth-errors';
import { colors, radius, spacing, typography } from '../../theme/colors';

const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email kiritilishi shart")
    .email("Email noto'g'ri formatda"),
  password: z.string().min(1, 'Parolni kiriting'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginScreen() {
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginFormValues) => {
    try {
      await login(values.email.trim().toLowerCase(), values.password);
      // Auth guard in root layout redirects to /(tabs).
    } catch (err) {
      Alert.alert("Kirib bo'lmadi", getAuthErrorMessage(err));
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Text style={styles.logoText}>B</Text>
            </View>
            <Text style={styles.brand}>bilgimAI</Text>
          </View>

          <Text style={styles.title}>Xush kelibsiz!</Text>
          <Text style={styles.subtitle}>
            Hisobingizga kirish uchun ma&apos;lumotlarni kiriting.
          </Text>

          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Email manzili"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                placeholder="misol@bilgim.ai"
                editable={!isSubmitting}
                error={errors.email?.message ?? null}
              />
            )}
          />

          <View style={styles.passwordWrapper}>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Parol"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  placeholder="********"
                  editable={!isSubmitting}
                  error={errors.password?.message ?? null}
                />
              )}
            />
            <Pressable 
              style={styles.eyeIcon}
              onPress={() => setShowPassword(!showPassword)}
            >
              <Ionicons 
                name={showPassword ? 'eye-off-outline' : 'eye-outline'} 
                size={22} 
                color={colors.creamDim} 
              />
            </Pressable>
            <Pressable style={styles.forgotPassword}>
              <Text style={styles.forgotPasswordText}>Unutdingizmi?</Text>
            </Pressable>
          </View>

          <Button
            label="Tizimga kirish"
            onPress={handleSubmit(onSubmit)}
            loading={isSubmitting}
            fullWidth
            style={styles.submitButton}
          />

          <View style={styles.footer}>
            <Text style={styles.footerText}>Hisobingiz yo&apos;qmi? </Text>
            <Link href="/(auth)/register" style={styles.link}>
              Ro&apos;yxatdan o&apos;tish
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ink },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logoContainer: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoText: {
    fontSize: 32,
    fontWeight: '900',
    color: colors.ink,
  },
  brand: {
    ...typography.h2,
    color: colors.cream,
    letterSpacing: 1,
  },
  title: {
    ...typography.display,
    color: colors.cream,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.creamDim,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  passwordWrapper: {
    position: 'relative',
  },
  eyeIcon: {
    position: 'absolute',
    right: 16,
    top: 40,
  },
  forgotPassword: {
    position: 'absolute',
    right: 0,
    top: 0,
  },
  forgotPasswordText: {
    ...typography.label,
    color: colors.accent,
  },
  submitButton: {
    marginTop: spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  footerText: {
    ...typography.body,
    color: colors.creamDim,
  },
  link: {
    ...typography.bodyStrong,
    color: colors.accent,
  },
});
