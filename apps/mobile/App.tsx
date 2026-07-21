/**
 * App.tsx — root component reference for the EduBridge mobile app.
 *
 * The runtime entry point is `expo-router/entry` (configured in
 * `package.json#main`), which scans the `app/` directory for file-based
 * routes. This file exists to:
 *
 *   1. Satisfy tooling that expects a top-level `App.tsx` (older RN
 *      templates, custom EAS Build hooks, dev-server boots without
 *      expo-router's main shim).
 *   2. Provide an explicit, importable root that mirrors the providers
 *      wired up in `app/_layout.tsx` so the navigation skeleton can be
 *      reasoned about in isolation.
 *
 * Navigation: expo-router is built on top of `@react-navigation/native`
 * and `@react-navigation/native-stack`, so the route tree below uses the
 * same primitives. Screens live in `app/(auth)/*` (Login / Register) and
 * `app/(tabs)/*` (Dashboard / Courses / Profile).
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LoginScreen from './app/(auth)/login';
import { AuthProvider, useAuth } from './lib/auth-context';
import { colors } from './theme/colors';

/**
 * Root stack — only Login and Dashboard placeholders are wired here as
 * required by task 22.1. The full tab navigator (Courses, Profile) lives
 * in `app/(tabs)/_layout.tsx` and is the production navigation tree.
 */
export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
};

export type DashboardScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'Dashboard'
>;

const Stack = createNativeStackNavigator<RootStackParamList>();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function DashboardPlaceholder(_props: DashboardScreenProps) {
  return <View style={styles.center} />;
}

function RootStack() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated ? (
        <Stack.Screen name="Dashboard" component={DashboardPlaceholder} />
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}

export default function App(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NavigationContainer>
            <StatusBar style="light" />
            <RootStack />
          </NavigationContainer>
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
