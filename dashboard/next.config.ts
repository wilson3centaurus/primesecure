import type { NextConfig } from "next";

// Every page is per-user and must show live device state, so Cache Components
// stays off: pages render at request time.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
