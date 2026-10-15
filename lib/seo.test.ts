import { afterEach, expect, test, vi } from "vitest";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { PRIVATE_PATHS, PUBLIC_PATHS } from "./seo";

afterEach(() => vi.unstubAllEnvs());

// Google's matching: rules are path prefixes, and a trailing `$` anchors the end.
function blocked(path: string) {
  const rules = [robots().rules].flat().filter((rule) => [rule.userAgent].flat().includes("*"));
  return rules.flatMap((rule) => [rule.disallow ?? []].flat())
    .some((rule) => rule.endsWith("$") ? path === rule.slice(0, -1) : path.startsWith(rule));
}

test("deployments that do not allow search indexing block every page", () => {
  for (const value of [undefined, "", "false", "1"]) {
    vi.stubEnv("ALLOW_SEARCH_INDEXING", value);
    expect(robots().sitemap).toBeUndefined();
    for (const path of [...PUBLIC_PATHS, "/app"]) expect(blocked(path)).toBe(true);
  }
});

test("production robots.txt blocks private routes and allows public pages and icons", () => {
  vi.stubEnv("ALLOW_SEARCH_INDEXING", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
  expect(robots().sitemap).toBe("https://app.example.com/sitemap.xml");
  for (const path of [...PUBLIC_PATHS, "/apple-icon", "/icon.svg", "/opengraph-image", "/accounting"]) {
    expect(blocked(path), path).toBe(false);
  }
  for (const path of [...PRIVATE_PATHS, "/app/settings", "/sign-in/factor-one", "/billing/"]) {
    expect(blocked(path), path).toBe(true);
  }
});

test("the sitemap lists only public pages, as absolute URLs on the app's origin", () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
  expect(sitemap().map((entry) => entry.url)).toEqual([
    "https://app.example.com/",
    "https://app.example.com/privacy",
    "https://app.example.com/terms",
    "https://app.example.com/cookies",
  ]);
});
