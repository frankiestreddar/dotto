/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  // Pins the workspace root explicitly — without this, Turbopack walks up from this file looking
  // for the nearest lockfile and finds a stray, unrelated one at /Users/<home>/package-lock.json
  // (outside this repo entirely), infers THAT as the workspace root, and prints a "multiple
  // lockfiles" warning on every dev/build. This repo's own package-lock.json is the only one that
  // should ever be considered.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
