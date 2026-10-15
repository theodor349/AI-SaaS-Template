// The Content Security Policy every page is served with, built from the services
// the app uses. proxy.ts sets it on each response; see docs/internals/security-headers.md
// for what it does and does not protect against.
import type { ConsentService } from "@/lib/consent/service";

// Origins a service loads from, by CSP fetch directive. Consent services declare
// them in their `origins` field, so registering a service updates the policy.
const originKinds = ["connect", "frame", "img", "script", "style", "worker"] as const;
export type CspOrigins = Partial<Record<(typeof originKinds)[number], readonly string[]>>;

export type CspOptions = {
  // The deployment's Convex URL, for its HTTPS and WebSocket origins.
  convexUrl?: string;
  clerkPublishableKey?: string;
  // `next dev`: React needs eval, and HMR opens a WebSocket to the app's origin.
  development: boolean;
  appUrl?: string;
  services: readonly ConsentService[];
  // Report violations without blocking them.
  reportOnly: boolean;
  // Where browsers send violation reports, such as Sentry's security endpoint.
  reportUrl?: string;
};

// Clerk's Cloudflare bot protection and its fraud protection service.
const clerkChallenges = "https://challenges.cloudflare.com";
const clerkProtect = "https://*.protect.clerk.com";

// The Frontend API origin a Clerk publishable key encodes: clerk-js, Clerk's UI, and
// its API all load from it, on *.clerk.accounts.dev or the production custom domain.
export function clerkFrontendApi(publishableKey: string | undefined) {
  const encoded = publishableKey?.match(/^pk_(?:test|live)_(.+)$/)?.[1];
  if (!encoded) return undefined;
  try {
    const host = atob(encoded).replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : undefined;
  } catch {
    return undefined;
  }
}

// The HTTPS (or loopback HTTP) origin of a URL and its WebSocket counterpart.
function withWebSocket(url: string | undefined) {
  if (!url) return [];
  const { origin, protocol } = new URL(url);
  return [origin, origin.replace(protocol, protocol === "https:" ? "wss:" : "ws:")];
}

// Sentry's endpoint for CSP violation reports, from a DSN of the form
// https://<key>@<host>[/<path>]/<project>.
export function sentrySecurityEndpoint(dsn: string, tags: { environment?: string; release?: string } = {}) {
  const url = new URL(dsn);
  const project = url.pathname.split("/").pop();
  const prefix = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
  const endpoint = new URL(`${url.protocol}//${url.host}${prefix}api/${project}/security/`);
  endpoint.searchParams.set("sentry_key", url.username);
  if (tags.environment) endpoint.searchParams.set("sentry_environment", tags.environment);
  if (tags.release) endpoint.searchParams.set("sentry_release", tags.release);
  return endpoint.href;
}

// The CSP header, and the Reporting-Endpoints header its report-to directive names.
export function contentSecurityPolicyHeaders(options: CspOptions) {
  const clerk = clerkFrontendApi(options.clerkPublishableKey);
  const directives: Record<string, Set<string>> = {
    "default-src": new Set(["'self'"]),
    // Static pages can't carry a per-request nonce, so Next's inline scripts need
    // 'unsafe-inline'; the allowlist still limits where script files load from.
    "script-src": new Set(["'self'", "'unsafe-inline'", ...(options.development ? ["'unsafe-eval'"] : []), ...(clerk ? [clerk] : []), clerkChallenges, clerkProtect]),
    "connect-src": new Set([
      "'self'",
      ...(options.development ? withWebSocket(options.appUrl).slice(1) : []),
      ...withWebSocket(options.convexUrl),
      ...(clerk ? [clerk] : []),
      "https://clerk-telemetry.com", "https://*.clerk-telemetry.com", `${clerkProtect}:*`,
    ]),
    "img-src": new Set(["'self'", "data:", "blob:", "https://img.clerk.com"]),
    "style-src": new Set(["'self'", "'unsafe-inline'"]),
    "worker-src": new Set(["'self'", "blob:"]),
    "frame-src": new Set([clerkChallenges, clerkProtect]),
    "frame-ancestors": new Set(["'none'"]),
    "form-action": new Set(["'self'"]),
    "base-uri": new Set(["'self'"]),
    "object-src": new Set(["'none'"]),
  };
  // Only the known kinds: defineConsentService's generic accepts extra keys.
  for (const { origins = {} } of options.services) {
    for (const kind of originKinds) {
      for (const value of origins[kind] ?? []) directives[`${kind}-src`].add(value);
    }
  }
  const policy = Object.entries(directives).map(([name, values]) => [name, ...values].join(" "));
  const headers: Record<string, string> = {};
  if (options.reportUrl) {
    policy.push(`report-uri ${options.reportUrl}`, "report-to csp");
    headers["Reporting-Endpoints"] = `csp="${options.reportUrl}"`;
  }
  headers[options.reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy"] = policy.join("; ");
  return headers;
}
