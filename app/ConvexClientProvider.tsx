"use client";

import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";
import { UserProvisioning } from "@/components/UserProvisioning";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const { sessionId, orgId, orgRole } = useAuth();
  // Remount readiness and query consumers together so an identity change cannot
  // render the previous scope while the SDK acquires and validates its next token.
  const scope = JSON.stringify([sessionId, orgId, orgRole]);
  return (
    <ConvexProviderWithClerk key={scope} client={convex} useAuth={useAuth}>
      <UserProvisioning />
      {children}
    </ConvexProviderWithClerk>
  );
}
