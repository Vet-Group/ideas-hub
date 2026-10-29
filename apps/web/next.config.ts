import { type NextConfig } from 'next';

// The repo's .env holds DATABASE_URL and the secrets for every app (local runs; CI sets variables).
try {
  process.loadEnvFile('../../.env');
} catch {
  // No .env file.
}

const config: NextConfig = {
  // The workspace packages ship TypeScript sources.
  transpilePackages: ['@ideas-hub/core', '@ideas-hub/db', '@ideas-hub/etsy', '@ideas-hub/worker'],
  images: {
    formats: ['image/webp'],
    // Signed thumbnails only (plan Step 6); `dangerouslyAllowLocalIP` stays off.
    localPatterns: [{ pathname: '/thumbs/**', search: '' }],
    // Next's defaults plus 320, the ad card width at 1x.
    imageSizes: [32, 48, 64, 96, 128, 256, 320, 384],
  },
  poweredByHeader: false,
};

export default config;
