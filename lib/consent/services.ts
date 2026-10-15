import { appConfig } from "@/app.config";
import { sentryConsentService } from "@/lib/sentry/consent-service";
import { CONSENT_COOKIE } from "./cookie";
import { defineConsentService } from "./service";

const consentChoice = defineConsentService({
  id: "consent",
  category: "essential",
  name: appConfig.appName,
  purpose: "Remembers your cookie choices.",
  storage: [
    { name: CONSENT_COOKIE, type: "cookie", purpose: "Stores which optional categories you allowed, and when.", duration: "12 months" },
  ],
});

const clerk = defineConsentService({
  id: "clerk",
  category: "essential",
  name: "Clerk",
  purpose: "Signs you in and keeps your account secure.",
  storage: [
    { name: "__session", type: "cookie", purpose: "Holds a short-lived token that proves you are signed in.", duration: "Until sign-out (refreshed every minute)" },
    { name: "__client_uat", type: "cookie", purpose: "Records when your sign-in last changed so open tabs stay in sync.", duration: "1 year" },
    { name: "__client", type: "cookie", purpose: "Keeps you signed in between visits. Set on Clerk's sign-in domain.", duration: "Session lifetime (7 days by default)" },
  ],
});

// Every service that may store data in the browser. The preferences dialog, the
// cookie table on /cookies, and the service runner are all generated from this list.
export const consentServices = [consentChoice, clerk, sentryConsentService];
