/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV === "development";

const nextConfig = {
  trailingSlash: false,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // Production uses a static export (`output: "export"`) served by the Go
  // runtime, which also serves /api/* on the same origin. The export-mode
  // setting is therefore only meaningful for `next build`; in development the
  // Next dev server (localhost:3000) has no API of its own.
  ...(isDev ? {} : { output: "export" }),
  // Development proxy: forward /api/* to the local Go runtime so the frontend
  // can keep using same-origin relative URLs in every mode. No-op for static
  // export builds (the Go runtime serves both frontend and API on one origin).
  ...(isDev
    ? {
        async rewrites() {
          const target = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:4317";
          return [{ source: "/api/:path*", destination: `${target}/api/:path*` }];
        },
      }
    : {}),
};

export default nextConfig;
