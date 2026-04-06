/** @type {import('next').NextConfig} */
const nextConfig = {
    async rewrites() {
        return [
            {
                source: '/api/:path*',
                destination: 'http://localhost:3000/api/:path*',
            },
            {
                source: '/assets/:path*',
                destination: 'http://localhost:3000/assets/:path*',
            },
            {
                source: '/health',
                destination: 'http://localhost:3000/health',
            },
        ];
    },
    images: {
        remotePatterns: [
            { protocol: 'https', hostname: '**' },
            { protocol: 'http', hostname: 'localhost' },
        ],
    },
};

export default nextConfig;
