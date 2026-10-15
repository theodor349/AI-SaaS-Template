import { sitemapFor } from "@/lib/seo";

export default function sitemap() {
  return sitemapFor(process.env.NEXT_PUBLIC_APP_URL);
}
