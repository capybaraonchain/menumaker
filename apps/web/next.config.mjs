/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@menumaker/ai',
    '@menumaker/core',
    '@menumaker/db',
    '@menumaker/nutrition'
  ],
}

export default nextConfig

