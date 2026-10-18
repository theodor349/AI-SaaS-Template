"use client";

import { ReactNode, useState } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";
import { UserProvisioning } from "@/components/UserProvisioning";
import { maintenanceMode } from "@/lib/maintenance";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const { isLoaded, sessionId, orgId, orgRole } = useAuth();
  // Remount readiness and query consumers together so an identity change cannot
  // render the previous scope while the SDK acquires and validates its next token.
  // Clerk's first load after hydration is not a change: Convex auth is still loading
  // then, so the server-rendered page stays mounted instead of replaying its animations.
  // While Clerk reloads, as during an organization switch, the last loaded key holds.
  const scope = JSON.stringify([sessionId, orgId, orgRole]);
  const [scopes, setScopes] = useState<{ first: string; current: string }>();
  if (isLoaded && scopes?.current !== scope) setScopes({ first: scopes?.first ?? scope, current: scope });
  const key = !scopes || scopes.current === scopes.first ? "first" : scopes.current;
  return (
    <ConvexProviderWithClerk key={key} client={convex} useAuth={useAuth}>
      {/* Provisioning writes to Convex, which refuses writes during maintenance. */}
      {!maintenanceMode && <UserProvisioning />}
      {children}
    </ConvexProviderWithClerk>
  );
}
