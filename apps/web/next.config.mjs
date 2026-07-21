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
    ],
  },
  // Removed standalone output for testing
};

export default withNextIntl(nextConfig);
