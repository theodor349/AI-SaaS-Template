import { describe, expect, test } from "vitest";
import {
  CONSENT_MAX_AGE_SECONDS, CONSENT_POLICY_VERSION, consentCookieValue, parseConsent, readCookie, serializeConsentCookie,
} from "./cookie";

const now = Date.parse("2026-10-14T12:00:00.000Z");
const encode = (value: unknown) => encodeURIComponent(JSON.stringify(value));

describe("consent cookie", () => {
  test("round-trips a choice through serialization and document.cookie", () => {
    const assignment = serializeConsentCookie({ analytics: true }, { secure: true, now });
    const [pair] = assignment.split(";");
    const consent = parseConsent(readCookie(`__session=abc; ${pair}; other=1`, "consent"), now);
    expect(consent).toEqual({ version: CONSENT_POLICY_VERSION, choices: { analytics: true }, decidedAt: "2026-10-14T12:00:00.000Z" });
  });

  test("sets SameSite=Lax, a 12-month expiry, and Secure unless asked not to", () => {
    const secure = serializeConsentCookie({ analytics: false }, { secure: true, now });
    expect(secure).toContain("; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    expect(CONSENT_MAX_AGE_SECONDS).toBeLessThanOrEqual(366 * 24 * 60 * 60);
    expect(serializeConsentCookie({ analytics: false }, { secure: false, now })).not.toContain("Secure");
  });

  test("treats a missing, malformed, or wrongly shaped cookie as no choice", () => {
    for (const value of [undefined, "", "%E0%A4%A", "not-json", encode(null), encode([]), encode("yes"),
      encode({ version: CONSENT_POLICY_VERSION, decidedAt: new Date(now).toISOString() }),
      encode({ version: CONSENT_POLICY_VERSION, choices: { analytics: true } }),
      encode({ version: CONSENT_POLICY_VERSION, choices: { analytics: true }, decidedAt: "yesterday" }),
      encode({ version: String(CONSENT_POLICY_VERSION), choices: { analytics: true }, decidedAt: new Date(now).toISOString() })]) {
      expect(parseConsent(value, now)).toBeNull();
    }
  });

  test("asks again after a policy version change", () => {
    const decidedAt = new Date(now).toISOString();
    expect(parseConsent(encode({ version: CONSENT_POLICY_VERSION - 1, choices: { analytics: true }, decidedAt }), now)).toBeNull();
    expect(parseConsent(encode({ version: CONSENT_POLICY_VERSION + 1, choices: { analytics: true }, decidedAt }), now)).toBeNull();
  });

  test("expires a choice older than the maximum age", () => {
    const value = consentCookieValue({ analytics: true }, now);
    expect(parseConsent(value, now + CONSENT_MAX_AGE_SECONDS * 1000)).not.toBeNull();
    expect(parseConsent(value, now + CONSENT_MAX_AGE_SECONDS * 1000 + 1)).toBeNull();
  });

  test("grants only categories stored as exactly true", () => {
    const decidedAt = new Date(now).toISOString();
    expect(parseConsent(encode({ version: CONSENT_POLICY_VERSION, choices: { analytics: "true" }, decidedAt }), now)?.choices)
      .toEqual({ analytics: false });
    expect(parseConsent(encode({ version: CONSENT_POLICY_VERSION, choices: {}, decidedAt }), now)?.choices)
      .toEqual({ analytics: false });
  });
});
