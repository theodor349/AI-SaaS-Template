// The browser Sentry SDK while analytics consent has it running, and undefined
// otherwise. Callers use this instead of importing @sentry/nextjs, so the SDK is
// only downloaded after consent and nothing reports once consent is withdrawn.
type BrowserSentry = {
  captureException: (error: unknown) => void;
  traceId: () => string;
  routerTransitionStart: (href: string, navigationType: string) => void;
};

let active: BrowserSentry | undefined;

export function setActiveBrowserSentry(sentry: BrowserSentry | undefined) {
  active = sentry;
}

export function activeBrowserSentry() {
  return active;
}
