"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { AlertCircleIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { AuthBoundary, AuthPending } from "@/components/auth/auth-boundary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, ButtonLabel } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountSkeleton, AccountTextSkeleton } from "./account-skeleton";

const deletionDescription =
  "Requesting deletion cancels subscription renewal. You have seven days to undo it. At the deadline, paid access ends and your account and application data are deleted. Unused paid time is not automatically refunded.";
const retentionDescription =
  "Lifetime access ends when deletion completes. Required billing records may be retained by the payment provider.";

export function AccountDeletion() {
  return (
    <AuthBoundary pending={<AccountDeletionSkeleton />}>
      <AccountDeletionContent />
    </AuthBoundary>
  );
}

function AccountDeletionSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Account deletion">
      <CardHeader>
        <CardTitle>Account deletion</CardTitle>
      </CardHeader>
      <CardContent>
        <p role="status" className="sr-only">
          Loading account deletion…
        </p>
        <div className="flex flex-col gap-4">
          <AccountTextSkeleton>{deletionDescription}</AccountTextSkeleton>
          <AccountTextSkeleton>{retentionDescription}</AccountTextSkeleton>
          <div>
            <div className="w-fit">
              <AccountSkeleton>
                <Button disabled variant="destructive">
                  <ButtonLabel loading={false} loadingText="Requesting...">
                    Delete account
                  </ButtonLabel>
                </Button>
              </AccountSkeleton>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AccountDeletionContent() {
  const current = useQuery(api.users.current);
  const canLoadDeletion =
    current?.status === "ready" || current?.status === "deleting";
  const deletion = useQuery(
    api.accountLifecycle.current,
    canLoadDeletion ? {} : "skip",
  );
  const requestDeletion = useMutation(api.accountLifecycle.requestDeletion);
  const recoverAccount = useMutation(api.accountLifecycle.recover);
  const [busyAction, setBusyAction] = useState<"request" | "recover" | null>(null);
  const isBusy = busyAction !== null;

  async function runDeletionOperation(operation: "request" | "recover") {
    if (isBusy) {
      return;
    }

    setBusyAction(operation);
    toast.dismiss("account-deletion-error");

    try {
      if (operation === "request") {
        await requestDeletion({});
      } else {
        await recoverAccount({});
      }
    } catch (error) {
      let description = "We couldn’t complete the request. Try again in a moment.";

      if (
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        error.data.code === "RECOVERY_UNAVAILABLE"
      ) {
        description =
          "The recovery window has closed. Deletion can no longer be undone.";
      }

      const title =
        operation === "request"
          ? "Couldn’t request account deletion"
          : "Couldn’t undo account deletion";

      toast.error(title, {
        description,
        id: "account-deletion-error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function handleRequestDeletion() {
    void runDeletionOperation("request");
  }

  function handleUndoDeletion() {
    void runDeletionOperation("recover");
  }

  if (!current || current.status === "provisioning") {
    return <AuthPending fallback={<AccountDeletionSkeleton />} />;
  }

  if (deletion === undefined) {
    return <AuthPending fallback={<AccountDeletionSkeleton />} />;
  }

  const isFinalizing =
    current.status === "deleting" || deletion?.finalizing === true;
  let deletionContent;

  if (deletion?.status === "pending" || isFinalizing) {
    let deletionMessage =
      "Deletion is scheduled. You can undo deletion before the deadline.";

    if (deletion?.status === "completed") {
      deletionMessage = "Your account and application data have been deleted.";
    } else if (isFinalizing) {
      deletionMessage =
        "Deletion is being completed. Recovery is no longer available.";
    } else if (deletion?.deleteAfter != null) {
      const deadline = new Date(deletion.deleteAfter).toLocaleString();
      deletionMessage = `Deletion scheduled for ${deadline}. You can undo deletion before then.`;
    }

    deletionContent = (
      <>
        <p>{deletionMessage}</p>
        {!isFinalizing && (
          <div>
            <Button
              disabled={isBusy}
              variant="destructive"
              onClick={handleUndoDeletion}
              aria-busy={busyAction === "recover"}
              aria-live="polite"
            >
              <ButtonLabel
                loading={busyAction === "recover"}
                loadingText="Undoing..."
              >
                Undo deletion
              </ButtonLabel>
            </Button>
          </div>
        )}
      </>
    );
  } else {
    deletionContent = (
      <>
        <p>{deletionDescription}</p>
        <p>{retentionDescription}</p>
        <div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                disabled={isBusy}
                aria-busy={busyAction === "request"}
                aria-live="polite"
              >
                <ButtonLabel
                  loading={busyAction === "request"}
                  loadingText="Requesting..."
                >
                  Delete account
                </ButtonLabel>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Request account deletion?</AlertDialogTitle>
                <AlertDialogDescription>
                  We will stop renewal and schedule permanent deletion in seven
                  days. You can undo the request during that window. Deletion
                  ends any remaining paid access and does not automatically
                  refund payments.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep account</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={handleRequestDeletion}
                >
                  Request deletion
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </>
    );
  }

  return (
    <Card aria-label="Account deletion">
      <CardHeader>
        <CardTitle>Account deletion</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {deletion?.failure && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Account cleanup needs another attempt</AlertTitle>
              <AlertDescription>
                We are retrying. Your account has not been fully deleted.
              </AlertDescription>
            </Alert>
          )}
          {deletionContent}
        </div>
      </CardContent>
    </Card>
  );
}
