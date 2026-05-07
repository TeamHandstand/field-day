/** @type {import('next').NextConfig} */
const remotePatterns = [
  // Virtual-hosted style S3 URLs: https://<bucket>.s3.<region>.amazonaws.com/...
  { protocol: "https", hostname: "*.s3.amazonaws.com" },
  { protocol: "https", hostname: "*.s3.*.amazonaws.com" },
];

if (process.env.S3_PUBLIC_BASE_URL) {
  try {
    const u = new URL(process.env.S3_PUBLIC_BASE_URL);
    remotePatterns.push({ protocol: u.protocol.replace(":", ""), hostname: u.hostname });
  } catch {
    /* ignore malformed URL */
  }
}

const nextConfig = {
  reactStrictMode: true,
  images: { remotePatterns },
};

module.exports = nextConfig;
