import { robotsFor } from "@/lib/seo";

export default function robots() {
  return robotsFor({
    allowIndexing: process.env.ALLOW_SEARCH_INDEXING === "true",
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  });
}
