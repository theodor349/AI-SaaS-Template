import type { Breadcrumb, Event } from "@sentry/nextjs";

const replacements: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi, "[email]"],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]"],
  [/\bBearer\s+[\w.~+/=-]+/gi, "Bearer [token]"],
  [/\b(?:sk|rk)_(?:test|live)_\w+|\bwhsec_[\w+/=]+|\bpolar_\w+_\w+/g, "[secret]"],
  // Values of query parameters that look like credentials, such as Clerk's
  // __clerk_db_jwt and __clerk_handshake.
  [/([?&#][^=&#\s]*(?:token|secret|password|passwd|jwt|handshake|ticket|session|code|key)[^=&#\s]*=)[^&#\s]+/gi, "$1[redacted]"],
];

export function scrubText(text: string) {
  return replacements.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}

// Replaces anything that looks like an email address or credential in every string
// of a Sentry event or breadcrumb, at any depth.
export function scrub<T>(value: T, depth = 0): T {
  if (typeof value === "string") return scrubText(value) as T;
  if (depth > 12 || typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1)) as T;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item, depth + 1)])) as T;
}

// Keeps only the Convex user ID; Sentry never receives emails, names, or IP addresses.
export function scrubEvent<E extends Event>(event: E): E {
  const scrubbed = scrub(event);
  scrubbed.user = event.user?.id === undefined ? undefined : { id: event.user.id };
  return scrubbed;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb) {
  return scrub(breadcrumb);
}
