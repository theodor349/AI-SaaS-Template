/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  // Preserve 127.0.0.1 in Clerk's internal rewrite when Next binds to loopback.
  skipProxyUrlNormalize: true,
}

module.exports = nextConfig
