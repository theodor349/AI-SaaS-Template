# Installable app

Android installs the app from Chrome as a PWA; there is no Play Store or TWA build. The [manifest](../../app/manifest.ts), its images, and the install offer all come from the app config and `app/icon.svg`, so rebranding needs no separate PWA assets.

## The service worker caches one page

[public/sw.js](../../public/sw.js) only replaces a failed navigation with the offline page. It never caches pages, `_next/static` assets, or API and provider requests, and it doesn't intercept anything except navigations. That is what makes deploys safe: nothing an installed app shows can come from an older deploy except the offline page, which each deploy replaces. Keep it that way. Caching signed-in HTML would show one user's page after another signs in on the same device, and caching app shells would need the versioned precaching and update prompts this design avoids. The update behavior is described in the worker itself.

The worker registers only in production builds, so `pnpm bootstrap` never exercises it. Test it against `next build` and `next start`, where Playwright's offline mode shows the offline page.

## Leaving the app and coming back

Clerk OAuth, Polar checkout, and the Polar customer portal leave the app's origin. Android keeps an out-of-scope page inside the installed app with a small browser toolbar, and returns to the standalone view when a navigation comes back into scope. The manifest's scope is the whole origin, so this works as long as two things hold:

- Provider flows navigate the current window. A new tab or `window.open` opens Chrome instead, and the user finishes signing in or paying outside the installed app.
- Return URLs are absolute URLs on the app's own origin. Clerk builds its callback from the current origin; checkout and portal pass `window.location.origin`, which [billingReturnUrl](../../convex/lib/billing.ts) checks against `APP_URL`.

Chrome on Android shares cookies between the browser and installed apps, so the user comes back signed in.

## The install offer follows sign-up

Chrome fires `beforeinstallprompt` when the app is installable, at most once per page load. [use-install-prompt.ts](../../components/pwa/use-install-prompt.ts) keeps the event for the profile menu and for the [one-time offer](../../app/(protected)/app/_components/install-offer.tsx). The offer shows only in the session that sign-up created, recognized by the session starting with the account, so an existing user signing in on a new device never sees it. Each event opens one install dialog. After the user declines, the menu item disappears until Chrome fires the event again.
