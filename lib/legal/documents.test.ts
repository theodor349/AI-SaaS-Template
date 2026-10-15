// @vitest-environment node
import { expect, test } from "vitest";
import { appConfig } from "../../app.config";
import { legalVersions } from "../../convex/lib/legal";
import { loadLegalDocument, legalSlugs } from "./documents";

const appUrl = "https://app.example.com/ignored-path";

test.each(legalSlugs)("%s renders with every placeholder filled in", (slug) => {
  const document = loadLegalDocument(slug, { appUrl });
  expect(document.markdown).not.toMatch(/\{\{|\}\}/);
  expect(document.markdown).not.toMatch(/^# /m);
  expect(document.effectiveDate).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
});

test("changing the company config changes every document", () => {
  const config = { ...appConfig, companyName: "Other Company ApS", companyCvr: "12345678" as const, companyAddress: "Other Street 2, 1000 Copenhagen" };
  for (const slug of legalSlugs) {
    const { markdown } = loadLegalDocument(slug, { config, appUrl });
    expect(markdown).not.toContain(appConfig.companyName);
    if (slug !== "cookies") expect(markdown).toContain("Other Company ApS (CVR 12345678), Other Street 2, 1000 Copenhagen");
  }
});

test("the documents users accept carry the versions Convex records", () => {
  expect(loadLegalDocument("terms", { appUrl }).version).toBe(legalVersions.terms);
  expect(loadLegalDocument("privacy", { appUrl }).version).toBe(legalVersions.privacy);
});

test("rendering needs the app URL", () => {
  expect(() => loadLegalDocument("terms", { appUrl: "" })).toThrow("NEXT_PUBLIC_APP_URL");
});
