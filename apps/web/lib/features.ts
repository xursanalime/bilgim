/**
 * Build-time feature flags.
 *
 * These gate whole product surfaces off the MVP without deleting their code,
 * so the work can be switched back on with an env var instead of a revert.
 *
 * `NEXT_PUBLIC_*` vars are inlined by Next at build time, which is what we
 * want: the flag decides what ships in the bundle, not what a running server
 * decides per request. Anything that needs to change without a redeploy
 * belongs in `SystemSetting` (see `billing.requireSubscription`) instead.
 */

/**
 * AI surfaces — the BilgimAI chat, the tutor sidebar, AI grading prechecks
 * and the admin prompt editor.
 *
 * Off for the MVP: AI is being deferred until the core teach → enrol →
 * submit → grade loop is finished, then integrated across the platform in
 * one pass. Set `NEXT_PUBLIC_AI_ENABLED=true` to bring it back.
 *
 * Defaults to disabled: an unset variable must not ship a half-finished
 * surface to users.
 */
export const AI_ENABLED = process.env.NEXT_PUBLIC_AI_ENABLED === 'true';
