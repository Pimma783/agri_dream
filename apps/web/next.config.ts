import type { NextConfig } from 'next';

// Same-origin deployment: the browser only talks to the web origin, and Next.js
// forwards /api/* to Express, so the session cookie stays first-party.
// API_INTERNAL_URL is server-side only (never use a NEXT_PUBLIC_ prefix).
// Dev: web http://localhost:3000, API http://localhost:4000.
const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  transpilePackages: ['@agrimatch/contracts'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/:path*` }];
  },
};

export default nextConfig;
