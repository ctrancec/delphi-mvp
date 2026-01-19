/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    typescript: {
        ignoreBuildErrors: true,
    },
    eslint: {
        ignoreDuringBuilds: true,
    },
    experimental: {
        // serverActions: true, // No longer needed in Next.js 14+
    },
    images: {
        domains: ['images.unsplash.com', 'api.microlink.io'],
    }
};

module.exports = nextConfig;
