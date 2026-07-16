'use client';

// Top-level error boundary (Next.js App Router convention).
//
// This fires only when the ROOT layout itself throws — i.e. something so
// fundamental (fonts, theme provider, design tokens) crashed that the app
// shell couldn't render at all. Because it replaces the root layout, it
// must define its own <html>/<body> and must NOT depend on the design
// system, i18n, or any other app code that might itself be the cause of
// the crash. Keep this file dependency-free.
//
// Almost all real-world crashes are instead caught by
// `app/[locale]/error.tsx`, which sits below the (working) root layout and
// can safely reuse the design system.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="uz">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#0B0B0F',
          color: '#F5F5F7',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 12px' }}>
            Nimadir noto&apos;g&apos;ri ketdi
          </h1>
          <p style={{ fontSize: 15, opacity: 0.75, margin: '0 0 24px' }}>
            Ilovada kutilmagan xatolik yuz berdi. Iltimos, sahifani qayta
            yuklab ko&apos;ring.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '10px 24px',
              borderRadius: 12,
              border: 'none',
              background: '#0071E3',
              color: '#fff',
              fontWeight: 700,
              fontSize: 15,
              cursor: 'pointer',
            }}
          >
            Qayta yuklash
          </button>
        </div>
      </body>
    </html>
  );
}
