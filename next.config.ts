import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/business/:slug', destination: '/vendors/:slug', permanent: false },
      { source: '/map', destination: '/explore?view=map', permanent: false },
    ]
  },
};

export default nextConfig;
