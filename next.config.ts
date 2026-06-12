import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isGitHubPages ? "/sells_map" : undefined,
  assetPrefix: isGitHubPages ? "/sells_map/" : undefined,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
