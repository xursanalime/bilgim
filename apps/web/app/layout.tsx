import type { Metadata } from 'next';
import { Inter, Space_Mono } from 'next/font/google';
import './globals.css';

/**
 * Typography stack — both self-hosted via next/font/google so rendering
 * is identical on every OS (no gambling on -apple-system/system-ui
 * fallbacks, which look inconsistent outside macOS/Chrome-on-Mac):
 *   - sans/display — Inter, for everything (body, headings, UI)
 *   - mono         — Space Mono, for code/badges/labels
 */
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter-google',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  variable: '--font-space-mono-google',
  display: 'swap',
  weight: ['400', '700'],
});

export const metadata: Metadata = {
  title: "Bilgim — Online ta'lim platformasi",
  description:
    "O'zbekiston uchun zamonaviy onlayn ta'lim platformasi. AI yordamchili, jonli efir, uy vazifa.",
};

export const viewport = { themeColor: '#F5F5F7' } as const;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      suppressHydrationWarning
      className={`${inter.variable} ${spaceMono.variable}`}
      style={{
        // Legacy var bridge so any older code still works.
        ['--font-cabinet' as string]: 'var(--font-syne)',
      }}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
