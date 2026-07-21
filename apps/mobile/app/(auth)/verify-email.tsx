/**
 * Verify-email screen — deep-link target for the link emailed by
 * `POST /auth/register`.
 *
 * The backend mails a URL of the form
 *
 *     https://edubridge.uz/uz/verify-email?token=<jwt>
 *
 * We register `edubridge://verify-email?token=...` as the mobile
 * counterpart in `app.json`'s `scheme`. expo-router parses the query
 * string; we forward `token` to `POST /auth/verify-email` and surface
 * one of three states:
 *
 *   - "verifying"  while the request is in flight
 *   - "success"    on 2xx — bounce back to /login after a beat
 *   - "error"      with the friendly Uzbek copy from `getAuthErrorMessage`
 *
 * Mirrors `apps/web/components/auth/verify-email-client.tsx`.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../components/ui/Button';
import { verifyEmail } from '../../lib/api/auth';
import { getAuthErrorMessage } from '../../lib/auth-errors';
import { colors, radius, spacing, typography } from '../../theme/colors';

type Status = 'idle' | 'verifying' | 'success' | 'error';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const tokenRaw = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = tokenRaw ?? null;

  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token || status !== 'idle') return;
    setStatus('verifying');

    void verifyEmail(token).then((result) => {
      if (result.ok) {
        setStatus('success');
      } else {
        setStatus('error');
        // `result.error` is `{ code, message }` — `getAuthErrorMessage`
        // recognises this shape and maps the code to friendly Uzbek
        // copy, falling back to the server-provided message.
        setErrorMessage(getAuthErrorMessage(result.error));
      }
    });
  }, [token, status]);

  // ── No token → instructional state ──────────────────────────────
  if (!token) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <Text style={styles.brand}>EduBridge</Text>
          <Text style={styles.title}>Pochta qutingizni tekshiring</Text>
          <Text style={styles.subtitle}>
            Tasdiqlash havolasi email pochtangizga yuborildi. Email
            ichidagi havolani bosing — ilova avtomatik ochiladi va
            akkauntingiz faollashadi.
          </Text>

          <Button
            label="Kirish sahifasiga qaytish"
            variant="secondary"
            fullWidth
            onPress={() => router.replace('/(auth)/login')}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ── Verifying ───────────────────────────────────────────────────
  if (status === 'verifying' || status === 'idle') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={[styles.container, styles.center]}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.subtitle, styles.centeredText]}>
            Tekshirilmoqda...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Success ─────────────────────────────────────────────────────
  if (status === 'success') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>✓</Text>
          </View>
          <Text style={styles.title}>Email tasdiqlandi!</Text>
          <Text style={styles.subtitle}>
            Akkauntingiz faollashtirildi. Endi email va parolingiz bilan
            kirishingiz mumkin.
          </Text>

          <Button
            label="Kirish"
            fullWidth
            onPress={() => router.replace('/(auth)/login')}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.brand}>EduBridge</Text>
        <Text style={styles.title}>Tasdiqlash muvaffaqiyatsiz</Text>
        <Text style={styles.subtitle}>
          {errorMessage ??
            'Tasdiqlash havolasi yaroqsiz yoki muddati tugagan.'}
        </Text>

        <Button
          label="Yangi havola so'rash"
          variant="secondary"
          fullWidth
          onPress={() => router.replace('/(auth)/register')}
          style={styles.action}
        />
        <Button
          label="Kirish sahifasiga qaytish"
          variant="ghost"
          fullWidth
          onPress={() => router.replace('/(auth)/login')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ink },
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
  },
  centeredText: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  brand: {
    ...typography.label,
    color: colors.accent,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.cream,
  },
  subtitle: {
    ...typography.body,
    color: colors.creamDim,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  badge: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  badgeText: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.accentForeground,
  },
  action: {
    marginBottom: spacing.md,
  },
});
