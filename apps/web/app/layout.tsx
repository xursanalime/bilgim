import type { Metadata } from 'next';
import { Inter, Syne, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/**
 * Apple-inspired typography stack:
 *   - Inter        — body & UI (clean, neutral, similar to SF Pro)
 *   - Syne         — display headings (geometric, distinctive)
 *   - JetBrains    — mono for badges, code, labels
 */
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
  display: 'swap',
  weight: ['600', '700', '800'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-jetbrains',
  display: 'swap',
  weight: ['400', '500', '700'],
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
      className={`${inter.variable} ${syne.variable} ${jetbrainsMono.variable}`}
      style={{
        // Legacy var bridges so any older code still works.
        ['--font-cabinet' as string]: 'var(--font-syne)',
      }}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
