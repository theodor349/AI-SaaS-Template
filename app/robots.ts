import type { MetadataRoute } from "next";
import { PRIVATE_PATHS, searchIndexingAllowed, siteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  if (!searchIndexingAllowed()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // `$` anchors the exact path, so "/app" does not also block "/apple-icon".
      disallow: PRIVATE_PATHS.flatMap((path) => [`${path}$`, `${path}/`]),
    },
    sitemap: new URL("/sitemap.xml", siteUrl()).href,
  };
}
