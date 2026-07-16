import { getToken, getTokens, tokens, tokenVars } from './tokens';

describe('design token bridge', () => {
  describe('static defaults (tokens)', () => {
    it('mirrors the brand primary from globals.css', () => {
      expect(tokens.brand.primary).toBe('#0071E3');
    });

    it('exposes semantic status colors', () => {
      expect(tokens.semantic.success).toBe('#10B981');
      expect(tokens.semantic.warn).toBe('#FF9F0A');
      expect(tokens.semantic.danger).toBe('#FF3B30');
    });

    it('exposes the AI accent', () => {
      expect(tokens.ai.accent).toBe('#AF52DE');
    });
  });

  describe('getToken — SSR / fallback behaviour', () => {
    it('falls back to the static hex when the CSS variable is unset', () => {
      // jsdom does not apply globals.css, so the variable resolves to empty
      // and getToken must return the provided static fallback (the SSR path).
      expect(getToken(tokenVars.brand.primary, tokens.brand.primary)).toBe(
        tokens.brand.primary,
      );
    });

    it('returns the fallback for tokens without a CSS variable', () => {
      expect(getToken(tokenVars.border.rim, tokens.border.rim)).toBe(
        tokens.border.rim,
      );
    });

    it('reads a live CSS variable triple and normalizes it to hex', () => {
      // Simulate a theme by setting the variable on :root.
      document.documentElement.style.setProperty('--blue', '10 20 30');
      expect(getToken('--blue', tokens.brand.primary)).toBe('#0A141E');
      document.documentElement.style.removeProperty('--blue');
    });

    it('falls back when a live value is not a recognizable triple', () => {
      document.documentElement.style.setProperty('--blue', 'not-a-color-triple-456');
      // Non-triple, non-empty values are returned as-is; here it is a string
      // so it is passed through. Empty values use the fallback instead.
      document.documentElement.style.setProperty('--bg-base', '   ');
      expect(getToken('--bg-base', tokens.surface.base)).toBe(tokens.surface.base);
      document.documentElement.style.removeProperty('--blue');
      document.documentElement.style.removeProperty('--bg-base');
    });
  });

  describe('getTokens', () => {
    it('resolves the full tree to the static defaults under SSR/jsdom', () => {
      const resolved = getTokens();
      expect(resolved).toEqual(tokens);
    });
  });
});
