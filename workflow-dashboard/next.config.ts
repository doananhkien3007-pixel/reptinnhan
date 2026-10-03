import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  // The dashboard reads Supabase directly in the browser, so it can deploy as
  // static files and consume zero Vercel Serverless Functions.
  output: 'export'
};

export default nextConfig;
