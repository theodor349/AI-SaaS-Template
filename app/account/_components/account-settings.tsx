"use client";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import NextLink from "next/link";
import { api } from "@/convex/_generated/api";
import { AuthPending } from "@/components/auth/auth-boundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

export function AccountSettings() {
  const current = useQuery(api.users.current);
  const deletion = useQuery(api.accountLifecycle.current, current?.status === "ready" || current?.status === "deleting" ? {} : "skip");
  const save = useMutation(api.profile.save);
  const request = useMutation(api.accountLifecycle.requestDeletion);
  const recover = useMutation(api.accountLifecycle.recover);
  const [draft, setDraft] = useState<{ firstName: string; lastName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const user = current?.status === "ready" ? current.user : null;
  const values = draft ?? { firstName: user?.firstName ?? "", lastName: user?.lastName ?? "" };
  async function run(operation: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); setMessage(success); }
    catch (error) {
      const code = error instanceof ConvexError && typeof error.data === "object" && error.data !== null ? error.data.code : null;
      setError(code === "INVALID_NAME" ? "Use names up to 100 characters without control characters." : code === "RECOVERY_UNAVAILABLE" ? "The recovery window has closed. Deletion can no longer be undone." : "We couldn’t complete the request. Try again in a moment.");
    } finally { setBusy(false); }
  }
  if (!current || current.status === "provisioning") return <AuthPending message="Setting up your account…" />;
  if (deletion === undefined) return <AuthPending message="Loading account settings…" />;
  const pending = deletion?.status === "pending";
  const finalizing = current.status === "deleting" || deletion?.finalizing;
  return <div className="flex flex-col gap-6">
    <h1 className="text-3xl font-bold">Your account</h1>
    {user && <Card><CardHeader><CardTitle>Profile</CardTitle></CardHeader><CardContent>
      <form className="flex flex-col gap-4" onSubmit={event => {
        event.preventDefault();
        const submitted = { firstName: values.firstName.trim(), lastName: values.lastName.trim() };
        void run(async () => { await save(submitted); setDraft(submitted); }, "Profile saved.");
      }}>
        <div className="flex flex-col gap-2"><Label htmlFor="first-name">First name</Label><Input id="first-name" maxLength={100} value={values.firstName} onChange={event => setDraft({ ...values, firstName: event.target.value })} /></div>
        <div className="flex flex-col gap-2"><Label htmlFor="last-name">Last name</Label><Input id="last-name" maxLength={100} value={values.lastName} onChange={event => setDraft({ ...values, lastName: event.target.value })} /></div>
        <p>Email: {user.email}</p><p>Your email is managed through your sign-in provider.</p>
        <div><Button disabled={busy} type="submit">Save profile</Button></div>
      </form>
    </CardContent></Card>}
    <Card><CardHeader><CardTitle>Account deletion</CardTitle></CardHeader><CardContent><div className="flex flex-col gap-4">
      {pending || finalizing ? <>
        <p>{deletion?.status === "completed" ? "Your account and application data have been deleted." : finalizing ? "Deletion is being completed. Recovery is no longer available." : `Deletion scheduled for ${new Date(deletion!.deleteAfter!).toLocaleString()}. You can undo deletion before then.`}</p>
        {!finalizing && <>
          <p>{deletion?.cancellationConfirmed ? "Subscription renewal is cancelled. Existing paid access remains until it expires or deletion completes." : "Stopping subscription renewal… Your request is recorded; billing cancellation is awaiting confirmation."}</p>
          <Button disabled={busy} variant="outline" onClick={() => void run(() => recover({}), "Deletion undone. Renewal remains cancelled; you can resume your subscription in Billing.")}>Undo deletion</Button>
        </>}
        {deletion?.failure && <p role="alert">Cleanup needs another attempt. We are retrying. Your account has not been fully deleted.</p>}
      </> : <>
        <p>Requesting deletion cancels subscription renewal. You have seven days to undo it. At the deadline, paid access ends and your account and application data are deleted. Unused paid time is not automatically refunded.</p>
        <p>Lifetime access ends when deletion completes. Required billing records may be retained by the payment provider.</p>
        <div><AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" disabled={busy}>Delete account</Button></AlertDialogTrigger>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Request account deletion?</AlertDialogTitle><AlertDialogDescription>We will stop renewal and schedule permanent deletion in seven days. You can undo the request during that window. Deletion ends any remaining paid access and does not automatically refund payments.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Keep account</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void run(() => request({}), "Deletion requested.")}>Request deletion</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog></div>
      </>}
      <div><Button asChild variant="outline"><NextLink href="/billing" prefetch={false}>Manage subscription</NextLink></Button></div>
    </div></CardContent></Card>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
