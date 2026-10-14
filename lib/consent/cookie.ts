import { optionalCategories, type OptionalCategory } from "./categories";

export const CONSENT_COOKIE = "consent";
// Bump when categories or services change in a way users must agree to again.
// Every stored choice with another version is treated as no choice.
export const CONSENT_POLICY_VERSION = 1;
// After this long the choice expires and users are asked again.
export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export type ConsentChoices = Record<OptionalCategory, boolean>;
export type Consent = { version: number; choices: ConsentChoices; decidedAt: string };

export function allChoices(granted: boolean) {
  return Object.fromEntries(optionalCategories.map((category) => [category, granted])) as ConsentChoices;
}

// The stored choice, or null when there is none, it is malformed, from another
// policy version, or expired. Categories missing from the cookie are not granted.
export function parseConsent(value: string | undefined, now = Date.now()): Consent | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== CONSENT_POLICY_VERSION || !isRecord(parsed.choices)) return null;
  if (typeof parsed.decidedAt !== "string") return null;
  const decidedAt = Date.parse(parsed.decidedAt);
  if (Number.isNaN(decidedAt) || now - decidedAt > CONSENT_MAX_AGE_SECONDS * 1000) return null;
  const stored = parsed.choices;
  const choices = Object.fromEntries(optionalCategories.map((category) => [category, stored[category] === true])) as ConsentChoices;
  return { version: CONSENT_POLICY_VERSION, choices, decidedAt: parsed.decidedAt };
}

export function consentCookieValue(choices: ConsentChoices, now = Date.now()) {
  const consent: Consent = { version: CONSENT_POLICY_VERSION, choices, decidedAt: new Date(now).toISOString() };
  return encodeURIComponent(JSON.stringify(consent));
}

// A document.cookie assignment. `secure` is false only on plain-HTTP loopback
// development servers, where browsers would drop a Secure cookie.
export function serializeConsentCookie(choices: ConsentChoices, { secure, now = Date.now() }: { secure: boolean; now?: number }) {
  return `${CONSENT_COOKIE}=${consentCookieValue(choices, now)}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

// Reads one cookie's raw value from a Cookie header or document.cookie.
export function readCookie(cookies: string, name: string) {
  for (const pair of cookies.split(";")) {
    const separator = pair.indexOf("=");
    if (separator !== -1 && pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
