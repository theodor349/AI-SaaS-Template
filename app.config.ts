// Product and company identity, the same in every environment. Next.js imports
// it as `@/app.config` and Convex as a relative path, so keep it free of
// imports, secrets, and per-environment values; those belong in environment
// variables. The brand icon lives in app/icon.svg.
type AppConfig = {
  appName: string;
  companyName: string;
  supportEmail: `${string}@${string}.${string}`;
  // The default page and link preview description; search results show about 155 characters.
  description: string;
  // Landing heading and page title; leave off trailing punctuation.
  tagline: string;
  // The company's public profiles, linked from its structured data.
  socialProfiles: `https://${string}`[];
  // The X account credited on link previews, or null.
  xHandle: `@${string}` | null;
  // The Open Graph image's colors, as hex. Match app/icon.svg.
  brandColors: { background: `#${string}`; foreground: `#${string}`; muted: `#${string}` };
};

export const appConfig = {
  appName: "AI SaaS Template",
  companyName: "Just Enough Solutions ApS",
  supportEmail: "support@justenoughsolutions.com",
  description: "A foundation for your next AI product, with Next.js, realtime data, account management, and paid access. Choose monthly, yearly, or lifetime Pro access.",
  tagline: "Your next idea starts here",
  socialProfiles: [],
  xHandle: null,
  brandColors: { background: "#161b1d", foreground: "#f9fbfb", muted: "#a3b1b5" },
} satisfies AppConfig;
