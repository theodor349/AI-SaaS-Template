"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FlagKey } from "@/convex/lib/featureFlags";

// The flag's value for the current user, or undefined while it loads. Render
// the component's skeleton until then, so flagged content never appears and
// then disappears. Every caller shares the one featureFlags.current
// subscription, which waits for Convex auth to settle. Hiding UI is not access
// control: backend functions behind a flag also call requireFlag.
export function useFlag(key: FlagKey) {
  const { isLoading } = useConvexAuth();
  const flags = useQuery(api.featureFlags.current, isLoading ? "skip" : {});
  return flags === undefined ? undefined : flags[key] === true;
}
