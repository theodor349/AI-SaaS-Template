import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

test.each(["not a url", "file:///tmp/1"])("the DSN %s turns Sentry off instead of throwing on import", async (dsn) => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", dsn);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { sentryDsn } = await import("./options");
  const { sentryConsentService } = await import("./consent-service");
  expect(sentryDsn).toBeUndefined();
  expect(sentryConsentService.origins.connect).toEqual([]);
  expect(error).toHaveBeenCalledOnce();
});

test("a valid DSN is kept and its host joins the policy", async () => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2");
  const { sentryConsentService } = await import("./consent-service");
  expect(sentryConsentService.origins.connect).toEqual(["https://o1.ingest.sentry.io"]);
});
