import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/business/:slug', destination: '/vendors/:slug', permanent: false },
      { source: '/map', destination: '/explore?view=map', permanent: false },
      { source: '/register-business', destination: '/register-vendor', permanent: false },
      { source: '/qr', destination: '/join', permanent: false },
    ]
  },
};

export default nextConfig;
