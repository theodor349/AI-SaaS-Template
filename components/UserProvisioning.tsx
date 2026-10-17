"use client";

import { useAuth } from "@clerk/nextjs";
import { Authenticated, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { useAction } from "@/lib/convex";
import { rateLimitMessage } from "@/lib/rate-limit";

// Mount inside ConvexProviderWithClerk. Public content remains usable; protected
// account consumers use users.current to gate on provisioning/ready/deleting.
export function UserProvisioning() {
  const { userId, sessionId } = useAuth();
  return (
    <Authenticated>
      <ProvisionCurrentUser key={JSON.stringify([userId, sessionId])} />
    </Authenticated>
  );
}

function ProvisionCurrentUser() {
  const current = useQuery(api.users.current);
  const ensure = useAction(api.users.ensureCurrentUser);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const needsProvisioning = current?.status === "provisioning";

  useEffect(() => {
    if (!needsProvisioning) return;
    let cancelled = false;
    ensure({}).catch((error: unknown) => {
      if (!cancelled) setFailure(rateLimitMessage(error) ?? "Account setup failed. Try again.");
    });
    return () => { cancelled = true; };
  }, [needsProvisioning, ensure, attempt]);

  if (needsProvisioning && failure) {
    return (
      <div role="alert" className="flex items-center justify-center gap-3 p-3">
        <p>{failure}</p>
        <Button variant="outline" onClick={() => { setFailure(null); setAttempt((value) => value + 1); }}>
          Retry account setup
        </Button>
      </div>
    );
  }
  if (current?.status === "deleting") return <p role="status" className="p-3 text-center">Account deletion has been requested.</p>;
  return null;
}
