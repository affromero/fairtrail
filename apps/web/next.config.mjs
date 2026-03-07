/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['playwright', 'better-sqlite3', 'geoip-lite'],
  experimental: {
    nodeMiddleware: true,
  },
};

export default nextConfig;
