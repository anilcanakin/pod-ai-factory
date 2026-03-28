import type { NextConfig } from "next";

const BACKEND = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND}/api/:path*`,
      },
      {
        source: '/assets/:path*',
        destination: `${BACKEND}/assets/:path*`,
      },
    ];
  },
};

export default nextConfig;
