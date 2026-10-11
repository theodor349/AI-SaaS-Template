"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import NextLink from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { AuthBoundary, AuthPending } from "@/components/auth/auth-boundary";
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
import { Button } from "@/components/ui/button";
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
                  Delete account
                </Button>
              </AccountSkeleton>
            </div>
          </div>
          <div>
            <div className="w-fit">
              <AccountSkeleton>
                <Button disabled variant="outline">
                  Manage subscription
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
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function runDeletionOperation(
    operation: () => Promise<unknown>,
    successMessage: string,
  ) {
    setIsBusy(true);
    setError("");
    setMessage("");

    try {
      await operation();
      setMessage(successMessage);
    } catch (error) {
      if (
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        error.data.code === "RECOVERY_UNAVAILABLE"
      ) {
        setError(
          "The recovery window has closed. Deletion can no longer be undone.",
        );
      } else {
        setError("We couldn’t complete the request. Try again in a moment.");
      }
    } finally {
      setIsBusy(false);
    }
  }

  function handleRequestDeletion() {
    void runDeletionOperation(() => requestDeletion({}), "Deletion requested.");
  }

  function handleUndoDeletion() {
    void runDeletionOperation(
      () => recoverAccount({}),
      "Deletion undone. Renewal remains cancelled; you can resume your subscription in Billing.",
    );
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

    let cancellationMessage =
      "Stopping subscription renewal… Your request is recorded; billing cancellation is awaiting confirmation.";

    if (deletion?.cancellationConfirmed) {
      cancellationMessage =
        "Subscription renewal is cancelled. Existing paid access remains until it expires or deletion completes.";
    }

    deletionContent = (
      <>
        <p>{deletionMessage}</p>
        {!isFinalizing && (
          <>
            <p>{cancellationMessage}</p>
            <Button
              disabled={isBusy}
              variant="outline"
              onClick={handleUndoDeletion}
            >
              Undo deletion
            </Button>
          </>
        )}
        {deletion?.failure && (
          <p role="alert">
            Cleanup needs another attempt. We are retrying. Your account has not
            been fully deleted.
          </p>
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
              <Button variant="destructive" disabled={isBusy}>
                Delete account
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
          {deletionContent}
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
