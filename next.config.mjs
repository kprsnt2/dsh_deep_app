/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Turbopack (the default bundler in Next.js 16) handles pdfjs-dist's
  // optional native `canvas` dependency by mapping it to an empty module, and
  // resolves the PDF.js worker in src/lib/attachments.ts. No polyfills or
  // aliases are needed.
};

export default nextConfig;
