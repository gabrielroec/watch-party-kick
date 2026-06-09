// @wpk/panel next config
// transpilePackages permite importar workspace @wpk/shared direto do TS
// sem precisar pre-buildar o pacote a cada mudanca.
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@wpk/shared"],
  reactStrictMode: true,
};
export default nextConfig;
