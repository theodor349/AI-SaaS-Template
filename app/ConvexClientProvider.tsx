"use client";

import { ReactNode, useState } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";
import { UserProvisioning } from "@/components/UserProvisioning";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const { isLoaded, sessionId, orgId, orgRole } = useAuth();
  // Remount readiness and query consumers together so an identity change cannot
  // render the previous scope while the SDK acquires and validates its next token.
  // Clerk's first load after hydration is not a change: Convex auth is still loading
  // then, so the server-rendered page stays mounted instead of replaying its animations.
  const scope = JSON.stringify([sessionId, orgId, orgRole]);
  const [firstScope, setFirstScope] = useState<string>();
  if (isLoaded && firstScope === undefined) setFirstScope(scope);
  const key = scope === (firstScope ?? scope) ? "first" : scope;
  return (
    <ConvexProviderWithClerk key={key} client={convex} useAuth={useAuth}>
      <UserProvisioning />
      {children}
    </ConvexProviderWithClerk>
  );
}
