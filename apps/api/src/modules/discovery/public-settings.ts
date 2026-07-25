/**
 * Allow-list for `GET /discovery/settings/:key` — the one unauthenticated
 * route that reads the `SystemSetting` table.
 *
 * `SystemSetting` is a free-form `key → Json` store that ADMINs write via
 * `PUT /admin/system-settings/:key`, and the model has no visibility
 * column. Serving an arbitrary caller-supplied key from it therefore
 * published *every* operational value an admin ever stored — integration
 * credentials, provider keys, internal pricing, feature flags — to anyone
 * who could guess the name.
 *
 * Adding a key here is a deliberate act of publication. Only put values in
 * this list that are safe on an unauthenticated marketing page.
 */
export const PUBLIC_SYSTEM_SETTING_KEYS: readonly string[] = [
  // Landing-page copy managed through the admin CMS panel
  // (`/admin/cms` → `apps/web/app/[locale]/page.tsx`).
  'MARKETING_CONTENT',
];

/** `true` when `key` may be served to an unauthenticated caller. */
export function isPublicSystemSettingKey(key: string): boolean {
  return PUBLIC_SYSTEM_SETTING_KEYS.includes(key);
}
