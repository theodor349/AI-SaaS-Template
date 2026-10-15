"use client";

import { useEffect } from "react";

// Registers public/sw.js, which shows the offline page when a navigation fails. The
// deployment ID in its URL installs a new worker with each deploy; see the update notes
// there. `next dev` skips it so development never meets a worker. Render once, in the
// root layout.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const version = process.env.NEXT_PUBLIC_DEPLOYMENT_VERSION;
    const url = version ? `/sw.js?v=${encodeURIComponent(version)}` : "/sw.js";
    // The app works the same without it, apart from the offline page.
    navigator.serviceWorker.register(url, { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
