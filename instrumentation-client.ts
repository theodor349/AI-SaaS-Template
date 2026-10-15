import { activeBrowserSentry } from "@/lib/sentry/active";

// Next calls this before every client-side navigation. It runs before hydration on
// every page, so it stays tiny: browser Sentry loads only after analytics consent.
export function onRouterTransitionStart(href: string, navigationType: string) {
  activeBrowserSentry()?.routerTransitionStart(href, navigationType);
}
