/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/coach",
        destination: "/coach/fitness",
        permanent: true,
      },
    ];
  },
  turbopack: {
    root: __dirname,
  },
};
module.exports = nextConfig;
