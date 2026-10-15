// Product and company identity, the same in every environment. Next.js imports
// it as `@/app.config` and Convex as a relative path, so keep it free of
// imports, secrets, and per-environment values; those belong in environment
// variables. The brand icon lives in app/icon.svg.
export type AppConfig = {
  appName: string;
  // The installed app's label under its home screen icon; keep it to about 12 characters.
  shortName: string;
  companyName: string;
  // Shown on every legal page, as the Danish E-Commerce Act requires.
  companyCvr: `${number}`;
  companyAddress: string;
  supportEmail: `${string}@${string}.${string}`;
  // The default page and link preview description; search results show about 155 characters.
  description: string;
  // Landing heading and page title; leave off trailing punctuation.
  tagline: string;
  // The company's public profiles, linked from its structured data.
  socialProfiles: `https://${string}`[];
  // The X account credited on link previews, or null.
  xHandle: `@${string}` | null;
  // The Open Graph image, app icon, and install screenshot colors, as hex. Match app/icon.svg.
  brandColors: { background: `#${string}`; foreground: `#${string}`; muted: `#${string}` };
};

export const appConfig = {
  appName: "AI SaaS Template",
  shortName: "AI SaaS",
  companyName: "Just Enough Solutions ApS",
  companyCvr: "00000000",
  companyAddress: "Example Street 1, 8000 Aarhus C, Denmark",
  supportEmail: "support@justenoughsolutions.com",
  description: "A foundation for your next AI product, with Next.js, realtime data, account management, and paid access. Choose monthly, yearly, or lifetime Pro access.",
  tagline: "Your next idea starts here",
  socialProfiles: [],
  xHandle: null,
  brandColors: { background: "#161b1d", foreground: "#f9fbfb", muted: "#a3b1b5" },
} satisfies AppConfig;
