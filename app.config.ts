// Product and company identity, the same in every environment. Next.js and Convex
// both import this module, so keep it free of framework imports, secrets, and
// per-environment values; those belong in environment variables.
export const appConfig = {
  appName: "AI SaaS Template",
  companyName: "Just Enough Solutions ApS",
  supportEmail: "support@justenoughsolutions.com",
} as const;
