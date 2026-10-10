"use client";

import { useAuth } from "@clerk/nextjs";
import { Authenticated, useAction, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";

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
  const [failed, setFailed] = useState(false);
  const needsProvisioning = current?.status === "provisioning";

  useEffect(() => {
    if (!needsProvisioning) return;
    let cancelled = false;
    ensure({}).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [needsProvisioning, ensure, attempt]);

  if (needsProvisioning && failed) {
    return (
      <div role="alert" className="flex items-center justify-center gap-3 p-3">
        <p>Account setup failed. Try again.</p>
        <Button variant="outline" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>
          Retry account setup
        </Button>
      </div>
    );
  }
  if (needsProvisioning) return <p role="status" className="p-3 text-center">Setting up your account…</p>;
  if (current?.status === "deleting") return <p role="status" className="p-3 text-center">Account deletion has been requested.</p>;
  return null;
}
