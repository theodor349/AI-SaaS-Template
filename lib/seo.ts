import type { Metadata, MetadataRoute } from "next";

// Pages listed in the sitemap. Each one sets its own title, description, and canonical URL.
export const PUBLIC_PATHS = ["/", "/privacy", "/terms", "/cookies"];

// Kept out of crawls. These pages also render noindex, which is what removes them from
// results; robots.txt only saves crawling them. "/app" is a path prefix, so it also
// covers "/apple-icon", which `ROBOTS_ALLOWED_PATHS` lets back in.
const ROBOTS_DISALLOWED_PATHS = [
  "/app", "/account", "/billing", "/checkout", "/sign-in", "/sign-up",
  "/api/", "/webhooks/", "/__clerk/", "/e2e/",
];
const ROBOTS_ALLOWED_PATHS = ["/", "/apple-icon"];

export const NOINDEX: Metadata["robots"] = { index: false };

// The public origin for absolute URLs. Falls back to Next's own default so builds
// without NEXT_PUBLIC_APP_URL, such as CI, still work; production always sets it.
export function siteUrl(appUrl = process.env.NEXT_PUBLIC_APP_URL) {
  return new URL(appUrl ?? "http://localhost:3000");
}

// Only the public production deployment sets ALLOW_SEARCH_INDEXING=true. Worktrees and
// the hosted development deployment leave it unset, so crawlers skip them entirely.
export function robotsFor({ allowIndexing, appUrl }: { allowIndexing: boolean; appUrl: string | undefined }): MetadataRoute.Robots {
  if (!allowIndexing) return { rules: { userAgent: "*", disallow: "/" } };
  if (!appUrl) throw new Error("ALLOW_SEARCH_INDEXING requires NEXT_PUBLIC_APP_URL for the sitemap URL.");
  return {
    rules: { userAgent: "*", allow: ROBOTS_ALLOWED_PATHS, disallow: ROBOTS_DISALLOWED_PATHS },
    sitemap: new URL("/sitemap.xml", appUrl).href,
  };
}

export function sitemapFor(appUrl: string | undefined): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({ url: new URL(path, siteUrl(appUrl)).href }));
}
