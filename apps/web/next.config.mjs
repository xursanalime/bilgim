import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n.ts');

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Permissions-Policy',
    // LiveKit live darslari uchun camera/mic/screen-share KERAK — shu origin (self)
    // uchun ruxsat berilgan, aks holda brauzer getUserMedia/getDisplayMedia ni jim
    // rad etadi va ruxsat so'ramaydi. `(self)` faqat shu domenga ruxsat beradi,
    // tashqi origin'larga emas. geolocation/payment butunlay o'chirilgan.
    value:
      'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // `unsafe-eval` was previously required by a `new Function(...)`
      // dynamic-import shim in protected-video-player.tsx (hiding the
      // optional, not-installed `shaka-player` package from webpack). That
      // shim now uses a `webpackIgnore` magic comment instead, so eval-like
      // execution is no longer needed anywhere in the app.
      // hCaptcha (Phase 3 — real bot-check widget) needs its script,
      // iframe challenge, and verify XHR allow-listed explicitly.
      "script-src 'self' 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com",
      "style-src 'self' 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com",
      // img-src: R2 dan to'g'ridan rasm yuklanmaydi, proxy orqali keladi (blob:)
      // Avatarlar va tashqi rasmlar uchun https: qo'shildi
      "img-src 'self' data: blob: https://avatars.githubusercontent.com",
      // media-src: video/audio faqat 'self' (proxy) yoki blob: (local) dan keladi
      // R2 to'g'ridan murojaat bloklangan — hls.js blob URL ishlatadi
      "media-src 'self' blob:",
      // connect-src: R2 ga to'g'ridan murojaat o'chirildi — faqat proxy orqali
      "connect-src 'self' ws://localhost:* wss://*.livekit.cloud http://localhost:* https://hcaptcha.com https://*.hcaptcha.com",
      "font-src 'self' data:",
      "frame-src https://hcaptcha.com https://*.hcaptcha.com",
      // frame-ancestors 'none' — sahifani hech qaysi origin iframe qila olmaydi
      // (X-Frame-Options: DENY ning zamonaviy ekvivalenti). script-src ga tegmaydi,
      // shuning uchun Next dev / Fast Refresh ishlashda davom etadi.
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@bilgim/ui',
    '@bilgim/shared-types',
    '@bilgim/i18n',
    '@livekit/components-react',
    'livekit-client',
    'tldraw',
  ],
  // Perf (task 14.3): trim heavy barrel imports so only the icons/animation
  // primitives actually used are bundled. Stable in Next 14.2; safe no-op if a
  // package has no barrel. Keeps initial JS lean for Core Web Vitals (R20.2).
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  images: {
    // Modern formats first — Next negotiates AVIF/WebP per request and falls
    // back to the original automatically (R20.2 image optimization).
    formats: ['image/avif', 'image/webp'],
    // Cache optimized variants for a day to avoid re-encoding on every hit.
    minimumCacheTTL: 60 * 60 * 24,
    // R2 to'g'ridan Next.js Image component da ishlatilmaydi —
    // protected media proxy orqali keladi (CSP `media-src 'self' blob:`).
    // Quyidagilar faqat OMMAVIY, DRM bo'lmagan rasmlar uchun (landing kabi):
    //  - avatars.githubusercontent.com — CSP `img-src` da allaqachon ruxsat berilgan.
    //  - images.unsplash.com — landing dekorativ cover/thumbnail rasmlari.
    // Optimized chiqishlar `/_next/image` (same-origin) orqali beriladi, shuning
    // uchun CSP `img-src 'self'` ularni qamrab oladi.
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
