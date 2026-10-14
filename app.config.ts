// Product and company identity, the same in every environment. Next.js imports
// it as `@/app.config` and Convex as a relative path, so keep it free of
// imports, secrets, and per-environment values; those belong in environment
// variables.
type AppConfig = {
  appName: string;
  companyName: string;
  supportEmail: `${string}@${string}.${string}`;
  description: string;
  // Landing heading and page title; leave off trailing punctuation.
  tagline: string;
};

export const appConfig = {
  appName: "AI SaaS Template",
  companyName: "Just Enough Solutions ApS",
  supportEmail: "support@justenoughsolutions.com",
  description: "A Next.js, Convex, and Clerk starter.",
  tagline: "Your next idea starts here",
} satisfies AppConfig;
