/**
 * Expo dynamic configuration.
 *
 * `app.config.ts` is loaded by Expo CLI / EAS Build at config-resolution
 * time. It receives the static config from `app.json` and lets us merge
 * runtime values (env vars, build profiles) without hard-coding them in
 * the manifest.
 *
 * For task 22.1 the only dynamic value we expose is the API base URL:
 *
 *   EXPO_PUBLIC_API_URL  Default `http://localhost:4000`
 *
 * Anything prefixed with `EXPO_PUBLIC_` is automatically inlined into the
 * mobile bundle by Metro, so we surface it both via `expo.extra.apiUrl`
 * (for `expo-constants` access) and as the standard `EXPO_PUBLIC_API_URL`
 * env var (which `lib/api-client.ts` reads from `process.env`). Secrets
 * MUST NOT be placed here — anything in `expo.extra` ships in the bundle.
 */

import type { ExpoConfig, ConfigContext } from 'expo/config';

const DEFAULT_API_URL = 'http://localhost:4000';

export default ({ config }: ConfigContext): ExpoConfig => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;

  return {
    // Inherit name, slug, scheme, splash, plugins, etc. from app.json.
    ...config,
    name: config.name ?? 'EduBridge',
    slug: config.slug ?? 'edubridge',
    extra: {
      ...(config.extra ?? {}),
      apiUrl,
      // Marker used by lib/api-client.ts so we can fall back through
      // expo-constants when `process.env` is unavailable (e.g. release
      // builds where Metro's env inlining behaved differently).
      EXPO_PUBLIC_API_URL: apiUrl,
    },
  };
};
