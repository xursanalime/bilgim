/**
 * Registration screen — collects email, username, password, fullName, role
 * and posts to `POST /api/v1/auth/register`. Email verification is handled
 * by the backend; this screen just shows a success alert and routes back
 * to /login so the user can sign in once verified.
 */

import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useRouter } from 'expo-router';
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

type Role = 'STUDENT' | 'TEACHER';

const registerSchema = z.object({
  fullName: z.string().trim().min(2, "To'liq ism kamida 2 belgi bo'lishi kerak"),
  username: z
    .string()
    .trim()
    .min(3, 'Username kamida 3 belgi')
    .regex(/^[a-z0-9_]+$/, 'Faqat kichik harf, raqam va _ ruxsat etiladi'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Email noto'g'ri formatda"),
  password: z
    .string()
    .min(8, "Parol kamida 8 belgi bo'lishi kerak"),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function RegisterScreen() {
  const { register } = useAuth();
  const router = useRouter();
  const [role, setRole] = useState<Role>('STUDENT');
  const [showPassword, setShowPassword] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: '', username: '', email: '', password: '' },
  });

  const onSubmit = async (values: RegisterFormValues) => {
    try {
      await register({
        fullName: values.fullName,
        username: values.username,
        email: values.email,
        password: values.password,
        role,
      });
      Alert.alert(
        "Ro'yxatdan o'tildi",
        "Email pochtangizga tasdiqlash xabari yuborildi. Tasdiqlangach kirishingiz mumkin.",
        [
          {
            text: 'OK',
            onPress: () => router.replace('/(auth)/verify-email'),
          },
        ],
      );
    } catch (err) {
      Alert.alert('Xato', getAuthErrorMessage(err));
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

          <Text style={styles.title}>Ro&apos;yxatdan o&apos;tish</Text>
          <Text style={styles.subtitle}>
            Yangi hisob yaratib, bilimlaringizni oshiring.
          </Text>

          <Controller
            control={control}
            name="fullName"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="To'liq ismingiz"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                autoCapitalize="words"
                placeholder="Masalan: Abdulla Qodiriy"
                editable={!isSubmitting}
                error={errors.fullName?.message ?? null}
              />
            )}
          />

          <Controller
            control={control}
            name="username"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Foydalanuvchi nomi"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="abdulla_99"
                editable={!isSubmitting}
                error={errors.username?.message ?? null}
              />
            )}
          />

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

          <View style={styles.passwordContainer}>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Parol yarating"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  secureTextEntry={!showPassword}
                  autoComplete="new-password"
                  placeholder="********"
                  editable={!isSubmitting}
                  error={errors.password?.message ?? null}
                  helperText="Kamida 8 ta belgidan iborat bo'lsin"
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
          </View>

          <Text style={styles.label}>Men ...</Text>
          <View style={styles.roleRow}>
            <RoleButton
              active={role === 'STUDENT'}
              onPress={() => setRole('STUDENT')}
              label="Talabaman"
              icon="school-outline"
            />
            <RoleButton
              active={role === 'TEACHER'}
              onPress={() => setRole('TEACHER')}
              label="O'qituvchiman"
              icon="briefcase-outline"
            />
          </View>

          <Button
            label="Ro'yxatdan o'tish"
            onPress={handleSubmit(onSubmit)}
            loading={isSubmitting}
            fullWidth
            style={styles.submitButton}
          />

          <View style={styles.footer}>
            <Text style={styles.footerText}>Hisobingiz bormi? </Text>
            <Link href="/(auth)/login" style={styles.link}>
              Tizimga kirish
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RoleButton({
  active,
  onPress,
  label,
  icon,
}: {
  active: boolean;
  onPress: () => void;
  label: string;
  icon: any;
}) {
  return (
    <Pressable
      style={[styles.roleButton, active && styles.roleButtonActive]}
      onPress={onPress}
    >
      <Ionicons 
        name={icon} 
        size={20} 
        color={active ? colors.accent : colors.creamDim} 
        style={{ marginBottom: 4 }}
      />
      <Text
        style={[styles.roleButtonText, active && styles.roleButtonTextActive]}
      >
        {label}
      </Text>
      {active && (
        <View style={styles.checkIcon}>
          <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ink },
  flex: { flex: 1 },
  container: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logoContainer: {
    width: 60,
    height: 60,
    borderRadius: radius.xl,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoText: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.ink,
  },
  brand: {
    ...typography.h3,
    color: colors.cream,
    letterSpacing: 1,
  },
  title: {
    ...typography.h1,
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
  passwordContainer: {
    position: 'relative',
  },
  eyeIcon: {
    position: 'absolute',
    right: 16,
    top: 40,
  },
  label: {
    ...typography.label,
    color: colors.creamDim,
    marginBottom: spacing.xs,
  },
  roleRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  roleButton: {
    flex: 1,
    height: 80,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBackground,
    position: 'relative',
  },
  roleButtonActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(0,232,122,0.12)',
  },
  roleButtonText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.creamDim,
  },
  roleButtonTextActive: {
    color: colors.accent,
  },
  checkIcon: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  submitButton: {
    marginTop: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
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

