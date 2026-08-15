/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@proofnote/api-types"],
  reactStrictMode: true,
  webpack: (config) => {
    // wagmi connectors barrel → @base-org/account → @coinbase/cdp-sdk 的可选
    // x402 支付模块未安装（本项目只用 injected 钱包），逐个别名置空。
    for (const mod of [
      "@x402/core/client",
      "@x402/core/server",
      "@x402/evm",
      "@x402/evm/batch-settlement/client",
      "@x402/evm/exact/client",
      "@x402/evm/exact/server",
      "@x402/evm/exact/v1/client",
      "@x402/evm/upto/client",
      "@x402/evm/upto/server",
      "@x402/express",
      "@x402/extensions/bazaar",
      "@x402/extensions/builder-code",
      "@x402/fetch",
      "@x402/svm/exact/client",
      "@x402/svm/exact/server",
      "@x402/svm/exact/v1/client",
    ]) {
      config.resolve.alias[mod] = false;
    }
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
