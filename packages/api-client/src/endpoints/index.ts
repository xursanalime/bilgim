/**
 * Re-exports for the typed endpoint groups. Apps usually consume them
 * via `createApiSdk(client)` (see `../sdk.ts`) but importing the raw
 * factories is fine for ad-hoc usage.
 */

export * from './auth';
export * from './lessons';
export * from './homework';
export * from './gamification';
