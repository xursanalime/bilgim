/**
 * Bilgim dark/cream palette — mirrors `apps/web/tailwind.config.ts` and
 * `apps/web/app/globals.css`.
 *
 *   #080C10 → ink           (page background)
 *   #0D1F36 → ink.surface   (cards)
 *   #13243C → ink.subtle    (hover / elevated)
 *   #00E87A → accent green  (primary action)
 *   #F5F2EC → cream         (foreground / text)
 *   #8892A4 → cream.dim     (muted secondary text)
 *   rgba(255,255,255,0.07) → ink.line (hairline borders)
 *
 * Native screens import `colors` from this module rather than hard-coding
 * hex values so we can swap themes (e.g. light mode) in a single place.
 */

export const colors = {
  // Backgrounds
  ink: '#080C10',
  inkSurface: '#0D1F36',
  inkSubtle: '#13243C',
  inkLine: 'rgba(255,255,255,0.07)',

  // Text
  cream: '#F5F2EC',
  creamDim: '#8892A4',

  // Brand / actions
  accent: '#00E87A',
  accentMuted: 'rgba(0,232,122,0.18)',
  accentForeground: '#080C10',

  // Status
  danger: '#F87171',
  warning: '#FBBF24',
  info: '#60A5FA',

  // Form helpers
  inputBackground: '#13243C',
  inputBorder: 'rgba(255,255,255,0.12)',
  inputBorderFocused: '#00E87A',
  placeholder: '#8892A4',

  // Overlays
  overlay: 'rgba(8,12,16,0.7)',
} as const;

export type AppColor = keyof typeof colors;

/**
 * Spacing scale (4-pt grid) reused across screens. Keeps padding/margin
 * values deterministic without pulling in a full styling library.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/**
 * Typography scale tuned to the cream-on-ink palette. Native does not
 * load Cabinet Grotesk / JetBrains Mono yet (Phase 8.2 will), so we use
 * the platform default sans font with the documented weights.
 */
export const typography = {
  display: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.6 },
  h1: { fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.4 },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.2 },
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;
