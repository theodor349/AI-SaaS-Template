"use client";

import { useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { appConfig } from "@/app.config";
import { api } from "@/convex/_generated/api";
import { AuthPending } from "@/components/auth/auth-boundary";
import { Link } from "@/components/typography/link";
import { Button, ButtonLabel } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMutation } from "@/lib/convex";

// The current terms and privacy notice are accepted where they're needed: before
// the paid product and before checkout, after sign-up and again after a material
// change. Account, billing management, and deletion never ask, so they stay
// available to users who haven't accepted. Use below an AuthBoundary.
export function useLegalAcceptance() {
  const status = useQuery(api.account.legal.status);
  return { isLoading: status === undefined, required: !!status && !status.accepted, updated: !!status?.previouslyAccepted };
}

function useAccept(onAccepted?: () => void) {
  const accept = useMutation(api.account.legal.accept);
  const [pending, setPending] = useState(false);

  async function run() {
    if (pending) return;
    setPending(true);
    toast.dismiss("legal-acceptance-error");
    try {
      await accept({});
      onAccepted?.();
    } catch {
      toast.error("Couldn’t record your acceptance", { description: "Try again in a moment.", id: "legal-acceptance-error" });
    } finally {
      setPending(false);
    }
  }

  return { accept: () => void run(), pending };
}

function AcceptanceText({ updated }: { updated: boolean }) {
  return (
    <>
      Accept the <Link href="/terms">Terms of Service</Link> and confirm you’ve read
      the <Link href="/privacy">Privacy Policy</Link> to {updated ? "keep using" : "use"} {appConfig.appName} and
      to buy a plan. Your account settings, billing, data export, and account deletion stay available either way.
    </>
  );
}

function AcceptButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <Button onClick={onClick} disabled={pending}>
      <ButtonLabel loading={pending} loadingText="Accepting…">Accept and continue</ButtonLabel>
    </Button>
  );
}

export function LegalAcceptanceCard() {
  const { updated } = useLegalAcceptance();
  const { accept, pending } = useAccept();
  return (
    <Card aria-label="Terms and privacy">
      <CardHeader>
        <CardTitle>{updated ? "We’ve updated our terms" : `Before you start using ${appConfig.appName}`}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <p><AcceptanceText updated={updated} /></p>
          <div><AcceptButton pending={pending} onClick={accept} /></div>
        </div>
      </CardContent>
    </Card>
  );
}

// Asks at the moment of an action that needs the terms, then continues it.
export function LegalAcceptanceDialog({ open, onOpenChange, onAccepted }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccepted: () => void;
}) {
  const { updated } = useLegalAcceptance();
  const { accept, pending } = useAccept(onAccepted);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{updated ? "We’ve updated our terms" : "Accept the terms to continue"}</DialogTitle>
          <DialogDescription><AcceptanceText updated={updated} /></DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Not now</Button></DialogClose>
          <AcceptButton pending={pending} onClick={accept} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Use below PaidBoundary: shows the paid product once the current terms are accepted.
export function LegalAcceptanceBoundary({ children }: { children: ReactNode }) {
  const { isLoading, required } = useLegalAcceptance();
  if (isLoading) return <AuthPending message="Checking your account…" />;
  if (required) return <LegalAcceptanceCard />;
  return children;
}
