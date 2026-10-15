import { defineConsentService } from "@/lib/consent/service";
import { sentryDsn } from "./options";

export const sentryConsentService = defineConsentService({
  id: "sentry",
  category: "analytics",
  name: "Sentry",
  purpose: "Reports errors and page performance so we can fix problems.",
  // Sentry keeps its state in memory: it sets no cookies or web storage here.
  storage: [],
  // The SDK itself is bundled with the app; only its events leave for the DSN's host.
  origins: { connect: sentryDsn ? [new URL(sentryDsn).origin] : [] },
  async load() {
    if (!sentryDsn) return;
    (await import("./browser")).startBrowserSentry();
  },
  async unload() {
    if (!sentryDsn) return;
    await (await import("./browser")).stopBrowserSentry();
  },
});
