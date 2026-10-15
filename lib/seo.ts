import type { Metadata } from "next";
import { appConfig } from "@/app.config";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/auth";

// Pages search engines may index. The sitemap lists exactly these.
export const PUBLIC_PATHS = ["/", "/privacy", "/terms", "/cookies"];

// Routes robots.txt keeps crawlers out of, with everything below them.
export const PRIVATE_PATHS = ["/app", "/account", "/billing", "/checkout", SIGN_IN_PATH, SIGN_UP_PATH, "/api", "/__clerk"];

// The public origin for canonical URLs, link previews, the sitemap, and robots.txt.
// Next.js inlines it at build time.
export function siteUrl() {
  return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
}

// Only the public production deployment sets ALLOW_SEARCH_INDEXING=true. Worktrees
// and the hosted development deployment leave it unset, so crawlers skip them.
export function searchIndexingAllowed() {
  return process.env.ALLOW_SEARCH_INDEXING === "true";
}

// Drawn by app/opengraph-image.tsx. Next.js drops that file's image from pages in
// other route segments that set their own Open Graph tags, so the defaults link it.
export const openGraphImage = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: `${appConfig.appName} — ${appConfig.tagline}`,
};

export const openGraphDefaults = {
  type: "website",
  siteName: appConfig.appName,
  locale: "en",
  images: openGraphImage,
} satisfies Metadata["openGraph"];

export const noIndex = { index: false, follow: false };

// Metadata for a page in PUBLIC_PATHS. A page's Open Graph tags replace the root
// layout's rather than merging, so they repeat the title, description, and defaults;
// Twitter cards fill in from Open Graph.
export function publicPageMetadata({ title, description, path }: {
  title: string | { absolute: string };
  description: string;
  path: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...openGraphDefaults, title, description, url: path },
  };
}
