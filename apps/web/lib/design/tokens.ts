/**
 * Semantic design-token bridge for JS consumers.
 *
 * The single source of truth for the design system lives in
 * `tailwind.config.ts` (utility classes) and `app/globals.css` (CSS custom
 * properties on `:root`). Components that render through Tailwind/JSX should
 * keep using the semantic utility classes (`bg-canvas`, `text-ink-strong`,
 * `text-blue`, `border-rim`, …).
 *
 * This module exists only for the JS consumers that *cannot* use Tailwind
 * classes and must hand a concrete color string to an imperative API:
 *   - chart libraries (stroke/fill props),
 *   - the watermark `<canvas>` / inline-style overlays,
 *   - dynamic inline `style={{ ... }}` values computed at runtime.
 *
 * Two ways to consume:
 *   - `tokens.brand.primary` — static hex default, safe on the server / in
 *     non-DOM contexts (SSR, tests, web workers).
 *   - `getToken(tokenVars.brand.primary, tokens.brand.primary)` or
 *     `getTokens()` — resolves the *live* CSS variable at runtime so the
 *     active theme (e.g. dark mode) is respected, falling back to the static
 *     hex default when no DOM is available.
 *
 * The static hex defaults below mirror the `:root` values in `globals.css`
 * exactly, so `getToken` and `tokens.*` resolve to the same color in the
 * default (light) theme. Do not hand-edit these to diverge from globals.css.
 *
 * Requirements: 5.2 — all colors expressed as design tokens, themeable from a
 * single source of truth.
 */

/** Shape of the semantic token tree. Every leaf is a CSS color string. */
export interface TokenTree {
  /** Surface / background colors. */
  readonly surface: {
    /** App background (`--bg-base`). */
    readonly base: string;
    /** Elevated panels / cards (`--bg-canvas`). */
    readonly canvas: string;
    /** Subtle tinted surface (`--bg-tint`). */
    readonly tint: string;
    /** Section divider surface (`--bg-soft`). */
    readonly soft: string;
  };
  /** Primary brand color (Apple blue). */
  readonly brand: {
    /** Primary brand / CTA / link (`--blue`). */
    readonly primary: string;
    /** Light primary tint (`--blue-tint`). */
    readonly primaryTint: string;
  };
  /** Status / feedback colors. */
  readonly semantic: {
    /** Success (`--green`). */
    readonly success: string;
    readonly successTint: string;
    /**
     * AA-safe text-only success shade (`--green-strong`). Use instead of
     * `success` for small body/status TEXT on the light canvas — the base
     * `success` fails WCAG AA (4.5:1) as small text (ACCESSIBILITY.md §3).
     */
    readonly successStrong: string;
    /** Warning / premium (`--orange`). */
    readonly warn: string;
    readonly warnTint: string;
    /** AA-safe text-only warning shade (`--orange-strong`). See `successStrong`. */
    readonly warnStrong: string;
    /** Danger / error (`--red`). */
    readonly danger: string;
    readonly dangerTint: string;
    /** AA-safe text-only danger shade (`--red-strong`). See `successStrong`. */
    readonly dangerStrong: string;
    /** Informational (`--teal`). */
    readonly info: string;
    /** AA-safe text-only info shade (`--teal-strong`). See `successStrong`. */
    readonly infoStrong: string;
  };
  /** AI tutor accent (purple). */
  readonly ai: {
    /** AI accent (`--purple`). */
    readonly accent: string;
    readonly accentTint: string;
    /** AA-safe text-only AI accent shade (`--purple-strong`). See `successStrong`. */
    readonly accentStrong: string;
  };
  /** Text / ink hierarchy. */
  readonly text: {
    /** Primary text (`--ink-strong`). */
    readonly strong: string;
    /** Secondary heading text (`--ink`). */
    readonly default: string;
    /** Body / muted text (`--ink-soft`). */
    readonly soft: string;
    /** Placeholder text (`--ink-faint`). */
    readonly faint: string;
    /** Disabled / ghost text (`--ink-ghost`). */
    readonly ghost: string;
  };
  /** Hairline borders. These are alpha-on-black rims, not CSS variables. */
  readonly border: {
    /** Default rim (`.border-rim` → rgb(0 0 0 / 0.07)). */
    readonly rim: string;
    /** Stronger rim (`.border-rim-2` → rgb(0 0 0 / 0.12)). */
    readonly rim2: string;
  };
  /** Signature hero gradient stops. */
  readonly gradient: {
    /** Hero gradient start (`--grad-hero-start`). */
    readonly heroFrom: string;
    /** Hero gradient end (`--grad-hero-end`). */
    readonly heroEnd: string;
  };
}

/**
 * CSS custom-property name for each token (where one exists).
 *
 * `null` means the token has no CSS variable in `globals.css` (it is a static
 * alpha-on-black rim), so it always resolves to its static default.
 */
type CssVarTree = {
  readonly [K in keyof TokenTree]: {
    readonly [P in keyof TokenTree[K]]: `--${string}` | null;
  };
};

/**
 * Static hex defaults — mirror the `:root` values in `app/globals.css`.
 * Used directly on the server / in non-DOM contexts and as the fallback for
 * {@link getToken}.
 */
export const tokens: TokenTree = {
  surface: {
    base: '#F5F5F7',
    canvas: '#FFFFFF',
    tint: '#FAFAFC',
    soft: '#E8E8ED',
  },
  brand: {
    primary: '#0071E3',
    primaryTint: '#E6F2FF',
  },
  semantic: {
    success: '#10B981',
    successTint: '#EBFCF5',
    successStrong: '#0E7C5A',
    warn: '#FF9F0A',
    warnTint: '#FFF5E6',
    warnStrong: '#B25E00',
    danger: '#FF3B30',
    dangerTint: '#FFEBE9',
    dangerStrong: '#D70015',
    info: '#32ADE6',
    infoStrong: '#1A7FB0',
  },
  ai: {
    accent: '#AF52DE',
    accentTint: '#F5EBFC',
    accentStrong: '#8E36C0',
  },
  text: {
    strong: '#1D1D1F',
    default: '#333338',
    soft: '#6E6E73',
    faint: '#AEAEB2',
    ghost: '#D1D1D6',
  },
  border: {
    rim: 'rgba(0, 0, 0, 0.07)',
    rim2: 'rgba(0, 0, 0, 0.12)',
  },
  gradient: {
    heroFrom: '#667EEA',
    heroEnd: '#764BA2',
  },
} as const;

/** CSS variable name for each semantic token (or `null` if it has none). */
export const tokenVars: CssVarTree = {
  surface: {
    base: '--bg-base',
    canvas: '--bg-canvas',
    tint: '--bg-tint',
    soft: '--bg-soft',
  },
  brand: {
    primary: '--blue',
    primaryTint: '--blue-tint',
  },
  semantic: {
    success: '--green',
    successTint: '--green-tint',
    successStrong: '--green-strong',
    warn: '--orange',
    warnTint: '--orange-tint',
    warnStrong: '--orange-strong',
    danger: '--red',
    dangerTint: '--red-tint',
    dangerStrong: '--red-strong',
    info: '--teal',
    infoStrong: '--teal-strong',
  },
  ai: {
    accent: '--purple',
    accentTint: '--purple-tint',
    accentStrong: '--purple-strong',
  },
  text: {
    strong: '--ink-strong',
    default: '--ink',
    soft: '--ink-soft',
    faint: '--ink-faint',
    ghost: '--ink-ghost',
  },
  border: {
    rim: null,
    rim2: null,
  },
  gradient: {
    heroFrom: '--grad-hero-start',
    heroEnd: '--grad-hero-end',
  },
} as const;

/**
 * Convert an `"R G B"` space-separated triple (the format used by the design
 * system's CSS variables) into a `#RRGGBB` hex string. Returns `null` when the
 * input is not a recognizable triple, so callers can fall back gracefully.
 */
function tripleToHex(raw: string): string | null {
  const parts = raw.trim().split(/[\s,]+/);
  if (parts.length !== 3) return null;
  const channels: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    channels.push(n);
  }
  return (
    '#' +
    channels
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/**
 * Normalize a raw CSS variable value into a usable color string.
 *
 * The design-system variables store `"R G B"` triples (e.g. `"0 113 227"`),
 * which are not valid standalone color strings, so they are converted to hex.
 * Values that are already complete colors (`#hex`, `rgb(...)`, `hsl(...)`, a
 * named color) are returned unchanged.
 */
function normalizeColor(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const hex = tripleToHex(value);
  if (hex) return hex;
  return value;
}

/** Read a CSS custom property off `:root`, or `null` outside the DOM. */
function readCssVar(cssVar: string): string | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  const root = document.documentElement;
  if (!root) return null;
  const raw = window.getComputedStyle(root).getPropertyValue(cssVar);
  return normalizeColor(raw);
}

/**
 * Resolve a single semantic token to a live color string.
 *
 * On the client this reads the *current* value of the CSS variable, so the
 * active theme (e.g. dark mode) is reflected. On the server / in non-DOM
 * contexts — or when the variable is unset — it returns `fallback`.
 *
 * @param cssVar  CSS variable name (e.g. `tokenVars.brand.primary`), or `null`
 *                for tokens that have no variable.
 * @param fallback Static hex default (e.g. `tokens.brand.primary`).
 *
 * @example
 * const stroke = getToken(tokenVars.brand.primary, tokens.brand.primary);
 * ctx.fillStyle = getToken(tokenVars.text.strong, tokens.text.strong);
 */
export function getToken(cssVar: `--${string}` | null, fallback: string): string {
  if (!cssVar) return fallback;
  return readCssVar(cssVar) ?? fallback;
}

/**
 * Resolve the entire token tree to live color strings in one call.
 *
 * Convenient for chart configs that need several colors at once. Each leaf is
 * resolved via {@link getToken}, so dark mode is respected on the client and
 * the static defaults are used during SSR.
 */
export function getTokens(): TokenTree {
  return {
    surface: {
      base: getToken(tokenVars.surface.base, tokens.surface.base),
      canvas: getToken(tokenVars.surface.canvas, tokens.surface.canvas),
      tint: getToken(tokenVars.surface.tint, tokens.surface.tint),
      soft: getToken(tokenVars.surface.soft, tokens.surface.soft),
    },
    brand: {
      primary: getToken(tokenVars.brand.primary, tokens.brand.primary),
      primaryTint: getToken(tokenVars.brand.primaryTint, tokens.brand.primaryTint),
    },
    semantic: {
      success: getToken(tokenVars.semantic.success, tokens.semantic.success),
      successTint: getToken(tokenVars.semantic.successTint, tokens.semantic.successTint),
      successStrong: getToken(tokenVars.semantic.successStrong, tokens.semantic.successStrong),
      warn: getToken(tokenVars.semantic.warn, tokens.semantic.warn),
      warnTint: getToken(tokenVars.semantic.warnTint, tokens.semantic.warnTint),
      warnStrong: getToken(tokenVars.semantic.warnStrong, tokens.semantic.warnStrong),
      danger: getToken(tokenVars.semantic.danger, tokens.semantic.danger),
      dangerTint: getToken(tokenVars.semantic.dangerTint, tokens.semantic.dangerTint),
      dangerStrong: getToken(tokenVars.semantic.dangerStrong, tokens.semantic.dangerStrong),
      info: getToken(tokenVars.semantic.info, tokens.semantic.info),
      infoStrong: getToken(tokenVars.semantic.infoStrong, tokens.semantic.infoStrong),
    },
    ai: {
      accent: getToken(tokenVars.ai.accent, tokens.ai.accent),
      accentTint: getToken(tokenVars.ai.accentTint, tokens.ai.accentTint),
      accentStrong: getToken(tokenVars.ai.accentStrong, tokens.ai.accentStrong),
    },
    text: {
      strong: getToken(tokenVars.text.strong, tokens.text.strong),
      default: getToken(tokenVars.text.default, tokens.text.default),
      soft: getToken(tokenVars.text.soft, tokens.text.soft),
      faint: getToken(tokenVars.text.faint, tokens.text.faint),
      ghost: getToken(tokenVars.text.ghost, tokens.text.ghost),
    },
    border: {
      rim: getToken(tokenVars.border.rim, tokens.border.rim),
      rim2: getToken(tokenVars.border.rim2, tokens.border.rim2),
    },
    gradient: {
      heroFrom: getToken(tokenVars.gradient.heroFrom, tokens.gradient.heroFrom),
      heroEnd: getToken(tokenVars.gradient.heroEnd, tokens.gradient.heroEnd),
    },
  };
}

export default tokens;
