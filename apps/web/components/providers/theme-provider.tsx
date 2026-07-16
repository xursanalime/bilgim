'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Theme model for the Bilgim Design System (R5.6).
 *
 *   - `light`  — Apple Liquid Glass Light (default `:root` tokens)
 *   - `dark`   — `.dark` CSS-var overrides in `globals.css`
 *   - `system` — follows the OS `prefers-color-scheme`
 *
 * Implemented as a tiny dependency-free provider (no `next-themes` in the
 * dependency tree). It toggles the `dark` class on `<html>` (Tailwind
 * `darkMode: ['class']`), persists the choice to `localStorage`, and reacts
 * to OS preference changes while in `system` mode.
 *
 * Hydration flash is prevented by a small inline script injected in the root
 * layout (`app/layout.tsx`) that sets the class before first paint using the
 * same storage key (`THEME_STORAGE_KEY`).
 */
export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'bilgim-theme';

interface ThemeContextValue {
  /** The user's selected preference (`light` | `dark` | `system`). */
  theme: Theme;
  /** The concrete theme currently applied (`light` | `dark`). */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

interface ThemeProviderProps {
  children: ReactNode;
  /** Initial preference before client storage is read. Defaults to `system`. */
  defaultTheme?: Theme;
}

export function ThemeProvider({
  children,
  defaultTheme = 'light',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  // Read persisted preference once on mount. The inline anti-flash script has
  // already applied the correct class, so this only syncs React state.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isTheme(stored)) {
        setThemeState(stored);
      }
    } catch {
      /* localStorage unavailable (private mode / SSR) — keep default */
    }
  }, []);

  // Resolve + apply the active theme and keep it in sync with OS changes
  // while the user is in `system` mode.
  useEffect(() => {
    const resolve = () => {
      const next: ResolvedTheme =
        theme === 'system' ? getSystemTheme() : theme;
      setResolvedTheme(next);
      applyResolvedTheme(next);
    };

    resolve();

    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (theme === 'system') resolve();
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore persistence failures */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}

/**
 * Inline script body that runs before first paint to avoid a flash of the
 * wrong theme. Kept here so the storage key stays in one place. Embedded via
 * `dangerouslySetInnerHTML` in the root layout.
 */
export const THEME_NO_FLASH_SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}';var t=localStorage.getItem(k)||'light';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
