// Set BASE_PATH (for example "/tickets") if the app is served from a subpath of another site.
const basePath = process.env.BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};
export default nextConfig;
