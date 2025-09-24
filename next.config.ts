const TARGET = process.env.EXPORT_TARGET as 'pages' | undefined;
const isPages = TARGET === 'pages';

const nextConfig = {
  ...(isPages
    ? { output: "export", trailingSlash: false }
    : {}),

  basePath: isPages ? "/ms" : "",

  assetPrefix: isPages ? "https://kfchem.github.io/ms/" : "",

  images: {
    unoptimized: isPages ,
  },
};

export default nextConfig;
