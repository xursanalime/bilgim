import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@edubridge/ui',
    '@edubridge/shared-types',
    '@edubridge/i18n',
    '@livekit/components-react',
    'livekit-client',
    'tldraw',
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
      },
      {
        protocol: 'https',
        hostname: '*.up.railway.app',
      },
    ],
  },
  // Required for infra/docker/Dockerfile.web's runner stage, which only
  // copies .next/standalone (not the full node_modules tree).
  output: 'standalone',

  // Static security response headers applied to every route. These are
  // zero-risk (no per-request state) and complement the nonce-based CSP set
  // in middleware.ts. HSTS is emitted only in production so local HTTP dev
  // isn't pinned to HTTPS.
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';
    const headers = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value:
          'accelerometer=(), autoplay=(), geolocation=(), gyroscope=(), magnetometer=(), payment=(), usb=()',
      },
    ];
    if (isProd) {
      headers.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains; preload',
      });
    }
    return [{ source: '/:path*', headers }];
  },
};

export default withNextIntl(nextConfig);
