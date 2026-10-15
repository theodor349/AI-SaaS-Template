// Product and company identity, the same in every environment. Next.js imports
// it as `@/app.config` and Convex as a relative path, so keep it free of
// imports, secrets, and per-environment values; those belong in environment
// variables. Together with the brand icon in app/icon.svg, this is what a new
// project edits to get its titles, descriptions, share images, and structured data.
type HexColor = `#${string}`;
type HttpsUrl = `https://${string}`;

type AppConfig = {
  appName: string;
  companyName: string;
  supportEmail: `${string}@${string}.${string}`;
  // Default search and link-preview description; aim for 150 characters or fewer.
  description: string;
  // Landing heading and page title; leave off trailing punctuation.
  tagline: string;
  // Optional; search engines ignore keywords, but some site search tools read them.
  keywords?: string[];
  // X account credited on link previews, e.g. "@example".
  socialHandle?: `@${string}`;
  // Colors of the generated Open Graph image and Apple touch icon. Keep the
  // background in step with app/icon.svg so the touch icon's corners blend in.
  brand: { background: HexColor; foreground: HexColor; muted: HexColor };
  // The company in the landing page's Organization structured data.
  organization: {
    // The company's own website, when it has one apart from this app.
    url?: HttpsUrl;
    // Public profiles that identify the company, such as LinkedIn or GitHub.
    sameAs: HttpsUrl[];
  };
};

// Annotated rather than `satisfies` so optional fields stay readable when unset.
export const appConfig: AppConfig = {
  appName: "AI SaaS Template",
  companyName: "Just Enough Solutions ApS",
  supportEmail: "support@justenoughsolutions.com",
  description: "A foundation for your next AI product, with Next.js, realtime data, account management, and paid access.",
  tagline: "Your next idea starts here",
  brand: { background: "#161b1d", foreground: "#f9fbfb", muted: "#a1a8ab" },
  organization: { sameAs: [] },
};
