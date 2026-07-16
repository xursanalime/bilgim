import type { Config } from 'tailwindcss';

/**
 * Bilgim Design System v2.0 — Apple Liquid Glass Light
 *
 * Brand palette:
 *   - Background  #F5F5F7
 *   - Blue        #0071E3 (primary, link, CTA)
 *   - Green       #34C759 (success, jonli)
 *   - Orange      #FF9F0A (premium, badge)
 *   - Red         #FF3B30 (error)
 *   - Purple      #AF52DE (AI tutor)
 *   - Ink         #1D1D1F (heading)
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1.25rem', sm: '2rem', lg: '2.5rem' },
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        // Shadcn-compatible tokens
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // ═══════════════════════════════════════
        // Apple system palette
        // ═══════════════════════════════════════

        // Surfaces — driven by CSS vars so they FLIP in dark mode
        // (`:root` light / `.dark` overrides live in globals.css).
        canvas: 'rgb(var(--bg-canvas) / <alpha-value>)',
        base: 'rgb(var(--bg-base) / <alpha-value>)',
        tint: 'rgb(var(--bg-tint) / <alpha-value>)',
        soft: 'rgb(var(--bg-soft) / <alpha-value>)',
        // Hairline rim borders (theme-aware, opacity baked into the var).
        rim: 'var(--rim)',
        'rim-2': 'var(--rim-2)',

        // Apple Blue — Primary (CTA, link)
        blue: {
          DEFAULT: 'rgb(var(--blue) / <alpha-value>)',
          50: '#E6F3FF',
          100: '#BFDFFF',
          200: '#80BFFF',
          300: '#4D9EFF',
          400: '#1A7DFF',
          500: '#0071E3',
          600: '#005CB8',
          700: '#00478C',
          800: '#003360',
          900: '#001F3D',
          tint: 'rgb(var(--blue-tint) / <alpha-value>)',
        },

        // Apple Green — Success (jonli, tasdiqlash)
        green: {
          DEFAULT: 'rgb(var(--green) / <alpha-value>)',
          // AA-safe text-only variant (ACCESSIBILITY.md §3) — use for small
          // body/status text instead of the base (vivid) DEFAULT, which
          // fails 4.5:1 on the light canvas.
          strong: 'rgb(var(--green-strong) / <alpha-value>)',
          50: '#E6FAEB',
          100: '#BFF1CC',
          200: '#80E2A0',
          300: '#4DD37D',
          400: '#1AC85F',
          500: '#34C759',
          600: '#2A9F47',
          700: '#1F7635',
          800: '#154D23',
          900: '#0A2511',
          tint: 'rgb(var(--green-tint) / <alpha-value>)',
        },

        // Apple Orange — Premium (badge, star, alert)
        orange: {
          DEFAULT: 'rgb(var(--orange) / <alpha-value>)',
          // AA-safe text-only variant (ACCESSIBILITY.md §3).
          strong: 'rgb(var(--orange-strong) / <alpha-value>)',
          50: '#FFF5E6',
          100: '#FFE3BF',
          200: '#FFC780',
          300: '#FFAB4D',
          400: '#FF9426',
          500: '#FF9F0A',
          600: '#CC7A00',
          700: '#995C00',
          800: '#663D00',
          900: '#331F00',
          tint: 'rgb(var(--orange-tint) / <alpha-value>)',
        },

        // Apple Red — Error / Live indicator
        red: {
          DEFAULT: 'rgb(var(--red) / <alpha-value>)',
          // AA-safe text-only variant (ACCESSIBILITY.md §3).
          strong: 'rgb(var(--red-strong) / <alpha-value>)',
          50: '#FFEBE9',
          100: '#FFC7C2',
          200: '#FF9E96',
          300: '#FF756A',
          400: '#FF4F42',
          500: '#FF3B30',
          600: '#E5251A',
          700: '#B31C12',
          800: '#80130D',
          900: '#4D0907',
          tint: 'rgb(var(--red-tint) / <alpha-value>)',
        },

        // Apple Purple — AI Tutor (magic, intellect)
        purple: {
          DEFAULT: 'rgb(var(--purple) / <alpha-value>)',
          // AA-safe text-only variant (ACCESSIBILITY.md §3).
          strong: 'rgb(var(--purple-strong) / <alpha-value>)',
          50: '#F5EBFC',
          100: '#E5C9F5',
          200: '#D2A0EB',
          300: '#BD78E2',
          400: '#A954D7',
          500: '#AF52DE',
          600: '#8C2BBA',
          700: '#69218B',
          800: '#46175D',
          900: '#230C2E',
          tint: 'rgb(var(--purple-tint) / <alpha-value>)',
        },

        teal: {
          DEFAULT: 'rgb(var(--teal) / <alpha-value>)',
          // AA-safe text-only variant (ACCESSIBILITY.md §3).
          strong: 'rgb(var(--teal-strong) / <alpha-value>)',
          400: '#5DBDEC',
          500: '#32ADE6',
          600: '#218BB8',
          tint: 'rgb(var(--teal) / 0.12)',
        },

        // Ink (text) hierarchy — theme-aware (flips in dark mode)
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          strong: 'rgb(var(--ink-strong) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
          ghost: 'rgb(var(--ink-ghost) / <alpha-value>)',
        },

        // Hero gradient stops
        hero: {
          from: '#667EEA',
          to: '#764BA2',
        },

        // ── Legacy aliases (back-compat with existing components) ──
        // Map old "coral" tokens to the new orange so older code still
        // renders pleasantly while we migrate.
        coral: {
          DEFAULT: '#FF9F0A',
          300: '#FFAB4D',
          400: '#FF9426',
          500: '#FF9F0A',
          600: '#CC7A00',
          tint: '#FFF5E6',
        },
        // Map old aurora to green
        aurora: {
          DEFAULT: '#34C759',
          400: '#1AC85F',
          500: '#34C759',
          600: '#2A9F47',
          mist: '#E6FAEB',
        },
        violet: {
          DEFAULT: '#AF52DE',
          400: '#A954D7',
          500: '#AF52DE',
          600: '#8C2BBA',
          mist: '#F5EBFC',
        },
        horizon: {
          DEFAULT: '#FF9F0A',
          400: '#FF9426',
          500: '#FF9F0A',
          600: '#CC7A00',
          mist: '#FFF5E6',
        },
        ember: {
          DEFAULT: '#FF3B30',
          400: '#FF4F42',
          500: '#FF3B30',
          600: '#E5251A',
        },
        midnight: {
          DEFAULT: '#1D1D1F',
          800: '#1D1D1F',
          900: '#0A0A0B',
        },
        cream: {
          DEFAULT: '#1D1D1F',
          dim: '#6E6E73',
        },
        accent2: {
          DEFAULT: '#34C759',
          400: '#1AC85F',
          500: '#34C759',
          600: '#2A9F47',
        },
      },

      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'SF Pro Text',
          'system-ui',
          'sans-serif',
        ],
        display: ['Syne', 'Inter', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        'display-xs': ['2.25rem', { lineHeight: '1.05', letterSpacing: '-0.04em' }],
        'display-sm': ['3rem', { lineHeight: '1.05', letterSpacing: '-0.04em' }],
        'display-md': ['3.75rem', { lineHeight: '0.98', letterSpacing: '-0.045em' }],
        'display-lg': ['4.5rem', { lineHeight: '0.95', letterSpacing: '-0.045em' }],
        'display-xl': ['6rem', { lineHeight: '0.92', letterSpacing: '-0.05em' }],
        'display-2xl': ['7.5rem', { lineHeight: '0.9', letterSpacing: '-0.05em' }],
      },

      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)',
        '4xl': '2rem',
        '5xl': '2.5rem',
      },

      backgroundImage: {
        'gradient-hero':
          'linear-gradient(135deg, #667EEA 0%, #764BA2 100%)',
        'gradient-blue-green':
          'linear-gradient(135deg, #0071E3 0%, #34C759 100%)',
        'gradient-orange':
          'linear-gradient(135deg, #FF9F0A 0%, #FF6B00 100%)',
      },

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        'slide-up-fade': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down-fade': {
          '0%': { opacity: '0', transform: 'translateY(-20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'gradient-x': {
          '0%, 100%': {
            'background-size': '200% 200%',
            'background-position': 'left center'
          },
          '50%': {
            'background-size': '200% 200%',
            'background-position': 'right center'
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'float': 'float 3s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up-fade': 'slide-up-fade 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down-fade': 'slide-down-fade 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'gradient-x': 'gradient-x 3s ease infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
