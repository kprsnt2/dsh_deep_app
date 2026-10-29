/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Turbopack (the default bundler in Next.js 16) handles pdfjs-dist's worker
  // and its optional native `canvas` dependency without extra configuration —
  // the bundle maps `canvas` to empty and the worker is imported with `?url`
  // in src/lib/attachments.ts. The previous webpack `canvas` alias is no
  // longer needed.
};

export default nextConfig;
