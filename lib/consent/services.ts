import { appConfig } from "@/app.config";
import { sentryConsentService } from "@/lib/sentry/consent-service";
import { INSTALL_OFFER_STORAGE_KEY } from "@/lib/pwa/install-offer";
import { THEME_STORAGE_KEY } from "@/lib/theme";
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

const themeChoice = defineConsentService({
  id: "theme",
  category: "essential",
  name: appConfig.appName,
  purpose: "Remembers your theme.",
  storage: [
    { name: THEME_STORAGE_KEY, type: "localStorage", purpose: "Stores whether you chose the light or dark theme. Absent when the theme follows your device.", duration: "Until you choose System or clear site data" },
  ],
});

// public/sw.js, whose CACHE is the cache named here, and the install offer in
// app/(protected)/app/_components/install-offer.tsx.
const installedApp = defineConsentService({
  id: "installed-app",
  category: "essential",
  name: appConfig.appName,
  purpose: "Lets you install the app and shows a page when you lose your connection.",
  storage: [
    { name: "offline", type: "cacheStorage", purpose: "Keeps a copy of the offline page to show when a page can't load without a connection.", duration: "Until the next version of the app replaces it" },
    { name: INSTALL_OFFER_STORAGE_KEY, type: "localStorage", purpose: "Remembers that you closed or answered the offer to install the app.", duration: "Until you clear site data" },
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
export const consentServices = [consentChoice, themeChoice, installedApp, clerk, sentryConsentService];
