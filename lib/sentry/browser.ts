import {
  captureException,
  captureRouterTransitionStart,
  close,
  getActiveSpan,
  getCurrentScope,
  init,
} from "@sentry/nextjs";
import { setActiveBrowserSentry } from "./active";
import { sentryOptions } from "./options";

function sampleRate(value: string | undefined, fallback: number) {
  const rate = Number(value);
  return value && rate >= 0 && rate <= 1 ? rate : fallback;
}

// Loaded dynamically by ./consent-service.ts once analytics is granted. The SDK's
// default browser tracing integration records page loads and, through
// instrumentation-client.ts, router transitions.
export function startBrowserSentry() {
  init({ ...sentryOptions, tracesSampleRate: sampleRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 1) });
  setActiveBrowserSentry({
    captureException: (error) => { captureException(error); },
    traceId: () => getActiveSpan()?.spanContext().traceId ?? getCurrentScope().getPropagationContext().traceId,
    routerTransitionStart: captureRouterTransitionStart,
  });
}

// Sends what is already queued, then disables the client. Its global handlers stay
// installed but drop events; a later start creates a new client.
export async function stopBrowserSentry() {
  setActiveBrowserSentry(undefined);
  await close(2000);
}
