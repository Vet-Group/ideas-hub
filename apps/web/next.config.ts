import { type NextConfig } from 'next';

// The repo's .env holds DATABASE_URL and the secrets for every app (local runs; CI sets variables).
try {
  process.loadEnvFile('../../.env');
} catch {
  // No .env file.
}

const config: NextConfig = {
  // The workspace packages ship TypeScript sources.
  transpilePackages: ['@ideas-hub/core', '@ideas-hub/db'],
  images: { formats: ['image/webp'] },
  poweredByHeader: false,
};

export default config;
