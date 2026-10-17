"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { appConfig } from "@/app.config";
import { AuthBoundary } from "@/components/auth/auth-boundary";
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
} from "@/components/ui/alert-dialog";
import { Button, ButtonLabel } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { planLabels } from "@/convex/billing/plans";
import { hasErrorCode } from "@/convex/lib/errors";
import { useMutation } from "@/lib/convex";

type Purchase = FunctionReturnType<typeof api.billing.withdrawals.purchases>[number];

const dateFormat = { day: "numeric", month: "long", year: "numeric" } as const;
const dateTimeFormat = { ...dateFormat, hour: "numeric", minute: "2-digit" } as const;

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, dateFormat);
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, dateTimeFormat);
}

// The 14-day right of withdrawal (forbrugeraftaleloven §20 a). Each purchase
// gets a withdrawal control while it can be withdrawn, and shows its refund
// while one is in progress.
export function PurchaseWithdrawal() {
  // Most accounts have nothing to withdraw, so loading shows nothing rather
  // than a skeleton that would usually disappear.
  return (
    <AuthBoundary pending={<></>}>
      <PurchaseWithdrawalContent />
    </AuthBoundary>
  );
}

// The current time, advanced when the next deadline passes so its control disappears.
function useNow(deadlines: number[]) {
  const [now, setNow] = useState(() => Date.now());
  const next = Math.min(...deadlines.filter((deadline) => deadline > now));
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setNow(Math.max(Date.now(), next)), Math.min(2_147_483_647, next - Date.now()));
    return () => clearTimeout(timer);
  }, [next]);
  return now;
}

function PurchaseWithdrawalContent() {
  const purchases = useQuery(api.billing.withdrawals.purchases);
  const current = useQuery(api.account.users.current);
  const request = useMutation(api.billing.withdrawals.request);
  const [selected, setSelected] = useState<Purchase | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const now = useNow(purchases?.map((purchase) => purchase.withdrawUntil) ?? []);

  const visible = purchases?.filter((purchase) =>
    purchase.withdrawal?.status === "pending" || purchase.withdrawUntil > now) ?? [];
  if (visible.length === 0) {
    return null;
  }

  async function confirm() {
    if (!selected || pendingOrderId) return;
    const { orderId } = selected;
    setSelected(null);
    setPendingOrderId(orderId);
    toast.dismiss("withdrawal-error");
    try {
      await request({ orderId });
    } catch (error) {
      const description = hasErrorCode(error, "WITHDRAWAL_PERIOD_ENDED")
        ? "The 14-day withdrawal period for this purchase has ended."
        : `Please try again, or email ${appConfig.supportEmail}.`;
      toast.error("We couldn’t receive your withdrawal", { description, id: "withdrawal-error" });
    } finally {
      setPendingOrderId(null);
    }
  }

  return (
    <Card aria-label="Withdraw from contract">
      <CardHeader>
        <CardTitle><h2>Withdraw from contract</h2></CardTitle>
        <CardDescription>
          You can withdraw from a purchase within 14 days and get a full refund, even if you have used it.
          Your Pro access ends when the refund is made.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-6">
          {visible.map((purchase) => (
            <PurchaseItem
              key={purchase.orderId}
              purchase={purchase}
              pending={pendingOrderId === purchase.orderId}
              disabled={pendingOrderId !== null}
              onWithdraw={() => setSelected(purchase)}
            />
          ))}
        </ul>
        <AlertDialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm your withdrawal</AlertDialogTitle>
              <AlertDialogDescription>
                You’re withdrawing from this purchase. We’ll refund the full amount through Polar to your original
                payment method within 14 days, and your Pro access ends when the refund is made.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {selected && <WithdrawalDetails purchase={selected} email={current?.status === "ready" ? current.user.email : null} />}
            <AlertDialogFooter>
              <AlertDialogCancel>Keep purchase</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void confirm()}>
                Confirm withdrawal
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

// The details that identify the withdrawn contract, as §20 a asks for.
function WithdrawalDetails({ purchase, email }: { purchase: Purchase; email: string | null }) {
  return (
    <dl className="flex flex-col gap-2 text-xs/relaxed">
      <Detail term="Purchase">{planLabels[purchase.model]}</Detail>
      <Detail term="Bought on">{formatDate(purchase.purchasedAt)}</Detail>
      <Detail term="Order">{purchase.orderId}</Detail>
      {email && <Detail term="Receipt to">{email}</Detail>}
    </dl>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="break-all">{children}</dd>
    </div>
  );
}

function PurchaseItem({ purchase, pending, disabled, onWithdraw }: {
  purchase: Purchase;
  pending: boolean;
  disabled: boolean;
  onWithdraw: () => void;
}) {
  const { withdrawal } = purchase;
  let status = `You can withdraw until ${formatDateTime(purchase.withdrawUntil - 1)}.`;
  if (withdrawal?.status === "pending") {
    status = `Withdrawal received ${formatDateTime(withdrawal.receivedAt)}. Your refund is being processed.`;
  } else if (withdrawal?.refundedAt) {
    status = `Withdrawn on ${formatDate(withdrawal.receivedAt)} and refunded on ${formatDate(withdrawal.refundedAt)}.`;
  }

  return (
    <li className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="font-medium">{planLabels[purchase.model]}, bought {formatDate(purchase.purchasedAt)}</p>
          <p className="text-muted-foreground" role={withdrawal ? "status" : undefined}>{status}</p>
        </div>
        {!withdrawal && (
          <Button variant="destructive" disabled={disabled} onClick={onWithdraw} aria-busy={pending} aria-live="polite">
            <ButtonLabel loading={pending} loadingText="Withdrawing…">Withdraw from contract</ButtonLabel>
          </Button>
        )}
      </div>
      {withdrawal?.failed && (
        <Alert variant="destructive">
          <AlertTitle>Your refund is delayed</AlertTitle>
          <AlertDescription>
            We couldn’t issue the refund yet and are retrying. If it hasn’t arrived within 14 days of your withdrawal,
            email {appConfig.supportEmail}.
          </AlertDescription>
        </Alert>
      )}
    </li>
  );
}
