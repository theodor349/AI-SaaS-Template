// Product and company identity, the same in every environment. Next.js imports
// it as `@/app.config` and Convex as a relative path, so keep it free of
// imports, secrets, and per-environment values; those belong in environment
// variables.
export type AppConfig = {
  appName: string;
  companyName: string;
  // Shown on every legal page, as the Danish E-Commerce Act requires.
  companyCvr: `${number}`;
  companyAddress: string;
  supportEmail: `${string}@${string}.${string}`;
  description: string;
  // Landing heading and page title; leave off trailing punctuation.
  tagline: string;
};

export const appConfig = {
  appName: "AI SaaS Template",
  companyName: "Just Enough Solutions ApS",
  companyCvr: "00000000",
  companyAddress: "Example Street 1, 8000 Aarhus C, Denmark",
  supportEmail: "support@justenoughsolutions.com",
  description: "A Next.js, Convex, and Clerk starter.",
  tagline: "Your next idea starts here",
} satisfies AppConfig;
