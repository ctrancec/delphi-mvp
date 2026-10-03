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
    },
    // The studio renders with ffmpeg. The binary is a file, not code, so it is
    // left out of the bundle and traced into the functions that run it, with
    // the fonts libass draws from.
    serverExternalPackages: ['ffmpeg-static'],
    outputFileTracingIncludes: {
        '/api/delphi/run': ['./node_modules/ffmpeg-static/ffmpeg', './src/lib/studio/fonts/*.ttf'],
        '/api/delphi/studio': ['./node_modules/ffmpeg-static/ffmpeg', './src/lib/studio/fonts/*.ttf'],
    },
};

module.exports = nextConfig;
