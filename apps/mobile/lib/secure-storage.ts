/**
 * Mobile token storage adapter.
 *
 * Implements the `TokenStorageAdapter` contract from
 * `@bilgim/api-client` against `expo-secure-store` (Keychain on iOS,
 * Keystore on Android). On the web target — where SecureStore is
 * unavailable — we fall back to `AsyncStorage`. Tokens NEVER live in
 * `localStorage` on mobile.
 *
 * Both `secureStorage` (the bare async k/v) and the named adapter are
 * exported so legacy call sites can keep working while the new auth
 * context migrates to the SDK surface.
 */

import type { TokenStorageAdapter } from '@bilgim/api-client';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const useSecure = Platform.OS !== 'web';

export const secureStorage: TokenStorageAdapter = {
  async get(key: string): Promise<string | null> {
    if (useSecure) {
      return SecureStore.getItemAsync(key);
    }
    return AsyncStorage.getItem(key);
  },

  async set(key: string, value: string): Promise<void> {
    if (useSecure) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  },

  async remove(key: string): Promise<void> {
    if (useSecure) {
      await SecureStore.deleteItemAsync(key);
      return;
    }
    await AsyncStorage.removeItem(key);
  },
};

/** Named alias for places that want the contract type. */
export const tokenStorageAdapter: TokenStorageAdapter = secureStorage;
