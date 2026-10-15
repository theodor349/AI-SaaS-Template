import { expect, test } from "vitest";
import { defineConsentService } from "@/lib/consent/service";
import { clerkFrontendApi, contentSecurityPolicyHeaders, sentrySecurityEndpoint, type CspOptions } from "./csp";

const clerkKey = (host: string, instance = "test") => `pk_${instance}_${btoa(`${host}$`)}`;
const base = { development: false, services: [], reportOnly: false } satisfies CspOptions;

function directives(options: CspOptions) {
  const headers = contentSecurityPolicyHeaders(options);
  const policy = headers["Content-Security-Policy"] ?? headers["Content-Security-Policy-Report-Only"];
  return Object.fromEntries(policy.split("; ").map((directive) => {
    const [name, ...values] = directive.split(" ");
    return [name, values];
  }));
}

test("loopback bootstrap allows its HTTP and WebSocket Convex origins, eval, and HMR", () => {
  const policy = directives({
    ...base,
    development: true,
    appUrl: "http://127.0.0.1:13963",
    convexUrl: "http://127.0.0.1:13964",
    clerkPublishableKey: clerkKey("dominant-doe-146.clerk.accounts.dev"),
  });
  expect(policy["connect-src"]).toEqual(expect.arrayContaining([
    "'self'", "ws://127.0.0.1:13963", "http://127.0.0.1:13964", "ws://127.0.0.1:13964", "https://dominant-doe-146.clerk.accounts.dev",
  ]));
  expect(policy["script-src"]).toEqual(expect.arrayContaining(["'unsafe-eval'", "https://dominant-doe-146.clerk.accounts.dev"]));
});

test("Tailscale bootstrap uses secure origins on the ts.net host", () => {
  const policy = directives({
    ...base,
    development: true,
    appUrl: "https://host.tail0.ts.net:61859",
    convexUrl: "https://host.tail0.ts.net:61860",
  });
  expect(policy["connect-src"]).toEqual(expect.arrayContaining([
    "wss://host.tail0.ts.net:61859", "https://host.tail0.ts.net:61860", "wss://host.tail0.ts.net:61860",
  ]));
  expect(policy["connect-src"].join(" ")).not.toMatch(/\bws:\/\//);
});

test("hosted production allows the Convex cloud and Clerk custom domain, without eval or HMR", () => {
  const policy = directives({
    ...base,
    appUrl: "https://app.example.com",
    convexUrl: "https://happy-otter-123.convex.cloud",
    clerkPublishableKey: clerkKey("clerk.example.com", "live"),
  });
  expect(policy["connect-src"]).toEqual(expect.arrayContaining([
    "https://happy-otter-123.convex.cloud", "wss://happy-otter-123.convex.cloud", "https://clerk.example.com",
  ]));
  expect(policy["connect-src"]).not.toContain("wss://app.example.com");
  expect(policy["script-src"]).not.toContain("'unsafe-eval'");
  expect(policy["script-src"]).toContain("https://clerk.example.com");
  expect(policy["frame-ancestors"]).toEqual(["'none'"]);
  expect(policy["object-src"]).toEqual(["'none'"]);
});

test("a consent service's origins join the policy with no other change", () => {
  const widget = defineConsentService({
    id: "widget", category: "analytics", name: "Widget", purpose: "Test.", storage: [],
    origins: { script: ["https://cdn.widget.example"], connect: ["https://api.widget.example"], frame: ["https://embed.widget.example"] },
  });
  const policy = directives({ ...base, services: [widget] });
  expect(policy["script-src"]).toContain("https://cdn.widget.example");
  expect(policy["connect-src"]).toContain("https://api.widget.example");
  expect(policy["frame-src"]).toContain("https://embed.widget.example");
});

test("an origin kind the policy doesn't know is ignored instead of breaking every page", () => {
  const widget = defineConsentService({
    id: "widget", category: "analytics", name: "Widget", purpose: "Test.", storage: [],
    origins: { connect: ["https://api.widget.example"], fonts: ["https://fonts.widget.example"] },
  });
  const headers = contentSecurityPolicyHeaders({ ...base, services: [widget] });
  expect(headers["Content-Security-Policy"]).toContain("https://api.widget.example");
  expect(headers["Content-Security-Policy"]).not.toContain("fonts");
});

test("report-only mode reports to Sentry's security endpoint without enforcing", () => {
  const reportUrl = sentrySecurityEndpoint("https://abc123@o1.ingest.us.sentry.io/456", { environment: "production", release: "deadbeef" });
  expect(reportUrl).toBe("https://o1.ingest.us.sentry.io/api/456/security/?sentry_key=abc123&sentry_environment=production&sentry_release=deadbeef");
  const headers = contentSecurityPolicyHeaders({ ...base, reportOnly: true, reportUrl });
  expect(headers["Content-Security-Policy"]).toBeUndefined();
  expect(headers["Content-Security-Policy-Report-Only"]).toContain(`report-uri ${reportUrl}; report-to csp`);
  expect(headers["Reporting-Endpoints"]).toBe(`csp="${reportUrl}"`);
  expect(contentSecurityPolicyHeaders(base)["Reporting-Endpoints"]).toBeUndefined();
});

test("Sentry DSNs with a path prefix keep it in the security endpoint", () => {
  expect(sentrySecurityEndpoint("http://e2e@127.0.0.1:13963/e2e/sentry/1"))
    .toBe("http://127.0.0.1:13963/e2e/sentry/api/1/security/?sentry_key=e2e");
});

test("only well-formed Clerk publishable keys yield a Frontend API origin", () => {
  expect(clerkFrontendApi(clerkKey("x.clerk.accounts.dev"))).toBe("https://x.clerk.accounts.dev");
  for (const key of [undefined, "", "pk_test_", "sk_test_abc", "pk_test_%%%", clerkKey("evil.example/path")]) {
    expect(clerkFrontendApi(key)).toBeUndefined();
  }
});
