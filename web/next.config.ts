import type { NextConfig } from "next"

const basePath = process.env.GITHUB_ACTIONS === "true" ? "/streaming-lab" : ""

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath,
  images: {
    unoptimized: true,
  },
}

export default nextConfig
