"use client";

import { useConvex, useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { createReconnectTracker, onReconnectReason } from "@/lib/convex-reconnect";
import { activeBrowserSentry } from "@/lib/sentry/active";

// Sends Convex reconnect timings to Sentry as metrics while analytics consent has
// browser Sentry running. Mount inside ConvexProviderWithClerk.
export function ConvexReconnectTelemetry() {
  const convex = useConvex();
  const { isRefreshing } = useConvexAuth();
  const [tracker] = useState(() =>
    createReconnectTracker((name, valueMs, attributes) =>
      activeBrowserSentry()?.distribution(name, Math.round(valueMs), attributes),
    ),
  );

  useEffect(() => {
    tracker.connection(convex.connectionState());
    tracker.online(navigator.onLine);
    tracker.visibility(document.visibilityState === "visible");
    const unsubscribe = convex.subscribeToConnectionState((state) => tracker.connection(state));
    const removeReasonListener = onReconnectReason((reason) => tracker.closeReason(reason));
    const onVisibility = () => tracker.visibility(document.visibilityState === "visible");
    const onOnline = () => tracker.online(navigator.onLine);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    return () => {
      unsubscribe();
      removeReasonListener();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
      tracker.dispose();
    };
  }, [convex, tracker]);

  useEffect(() => tracker.refreshing(isRefreshing), [tracker, isRefreshing]);

  return null;
}
