/**
 * Root layout — wraps the app in QueryClientProvider, AuthProvider and a
 * SafeAreaProvider, then declares the navigation tree (auth stack vs tabs).
 *
 * The auth guard is implemented as an effect inside <RootNavigator>: if the
 * user is logged in we redirect away from /(auth)/* and vice versa. While
 * the session is being hydrated from SecureStore we keep the splash screen
 * visible so we don't flash the login screen for already-signed-in users.
 *
 * Task 22.2 wiring — the layout also bootstraps:
 *   - Push notifications (permission, token registration, deep-link tap
 *     handler).
 *   - Background fetch (15-min periodic sync of notifications + recent
 *     lessons metadata).
 *   - SQLite cache for offline lesson viewing (opened lazily on first
 *     read; we open it eagerly here so the disk migration cost is paid
 *     during the splash screen rather than on first lesson tap).
 *
 * All Task 22.2 modules live in `lib/notifications`, `lib/cache`, and
 * `lib/sync`. Each has a `bootstrap*` helper that is safe to call on
 * web (where the underlying APIs are unavailable — they no-op).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../lib/auth-context';
import { openCacheDatabase } from '../lib/cache';
import {
  bootstrapPushNotifications,
  type BootstrapResult,
} from '../lib/notifications';
import {
  registerBackgroundSync,
  unregisterBackgroundSync,
} from '../lib/sync';
import { colors } from '../theme/colors';

// Keep the splash screen visible while we boot. This prevents the auth
// flash when SecureStore takes a moment to return on cold start.
SplashScreen.preventAutoHideAsync().catch(() => {
  /* expo-splash-screen throws on web; safe to ignore. */
});

function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const pushBootstrapRef = useRef<BootstrapResult | null>(null);

  // Auth guard — keeps signed-in users out of /(auth)/* and vice versa.
  useEffect(() => {
    if (isLoading) return;

    // Hide splash once we know whether we are signed in.
    SplashScreen.hideAsync().catch(() => {
      /* ignore */
    });

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments, router]);

  // Bootstrap caches and push notifications once we have a logged-in
  // session. We tear them down on sign-out so a different user that
  // logs in next does not inherit the previous session's push token.
  useEffect(() => {
    if (isLoading) return;

    // Open the SQLite cache early — runs schema migration during the
    // splash screen rather than on first lesson tap. Safe to call on
    // every layout mount; subsequent calls return the cached handle.
    void openCacheDatabase();

    if (!isAuthenticated) {
      // Tear down anything left over from a previous session. We
      // intentionally do not unregister the push token here — that
      // is the auth-context's responsibility on `logout()` so the
      // backend hears about it on a deliberate sign-out only.
      pushBootstrapRef.current?.cleanup();
      pushBootstrapRef.current = null;
      void unregisterBackgroundSync();
      return;
    }

    let cancelled = false;
    void (async () => {
      const result = await bootstrapPushNotifications({ router });
      if (cancelled) {
        result.cleanup();
        return;
      }
      pushBootstrapRef.current = result;
      // Background sync is independent of permission status — even
      // without push permission we still want to refresh the inbox
      // periodically so the unread badge stays accurate.
      await registerBackgroundSync();
    })();

    return () => {
      cancelled = true;
      pushBootstrapRef.current?.cleanup();
      pushBootstrapRef.current = null;
    };
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
    [],
  );

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
});
