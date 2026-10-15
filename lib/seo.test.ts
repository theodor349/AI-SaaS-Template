import { describe, expect, it } from "vitest";
import { PUBLIC_PATHS, robotsFor, sitemapFor } from "./seo";

const hosted = "https://app.example.com";

describe("robotsFor", () => {
  it("disallows everything when indexing is not allowed", () => {
    for (const appUrl of ["http://127.0.0.1:10000", "https://agent.example.ts.net:54321", hosted, undefined]) {
      const robots = robotsFor({ allowIndexing: false, appUrl });
      expect(robots).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    }
  });

  it("disallows protected and auth routes and links the sitemap in production", () => {
    const robots = robotsFor({ allowIndexing: true, appUrl: hosted });
    const rules = [robots.rules].flat()[0];
    expect(rules.disallow).toEqual(expect.arrayContaining(["/app", "/account", "/billing", "/checkout", "/sign-in", "/sign-up", "/api/", "/webhooks/"]));
    expect(rules.allow).toEqual(expect.arrayContaining(["/", "/apple-icon"]));
    expect(robots.sitemap).toBe("https://app.example.com/sitemap.xml");
  });

  it("refuses to allow indexing without a public app URL", () => {
    expect(() => robotsFor({ allowIndexing: true, appUrl: undefined })).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});

describe("sitemapFor", () => {
  it("lists only public pages as absolute URLs on the app origin", () => {
    expect(sitemapFor(`${hosted}/`).map((entry) => entry.url)).toEqual([
      "https://app.example.com/",
      "https://app.example.com/privacy",
      "https://app.example.com/terms",
      "https://app.example.com/cookies",
    ]);
  });

  it("keeps protected and auth routes out", () => {
    const paths = sitemapFor(hosted).map((entry) => new URL(entry.url).pathname);
    expect(paths).toEqual(PUBLIC_PATHS);
  });
});
