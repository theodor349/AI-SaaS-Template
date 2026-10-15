"use client";

import { useEffect, useState } from "react";

// Throws during a render in the browser only, so the error boundary receives a
// client error without a server digest.
export function ClientCrash() {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the crash must happen after hydration.
  useEffect(() => setMounted(true), []);
  if (mounted) throw new Error("E2E client crash");
  return null;
}
