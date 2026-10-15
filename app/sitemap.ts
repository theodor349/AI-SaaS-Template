import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, siteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({ url: new URL(path, siteUrl()).href }));
}
