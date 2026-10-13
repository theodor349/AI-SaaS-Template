"use client";

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
import type { RecurringModel } from "@/convex/lib/billingModel";

export function PlanSwitchConfirmation({ plan, disabled, onCancel, onConfirm }: {
  plan: RecurringModel | null;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={plan !== null && !disabled} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch to {plan}?</AlertDialogTitle>
          <AlertDialogDescription>
            {plan === "yearly"
              ? "You will be charged immediately when you switch to yearly."
              : "You will not be charged again until the end of your current one-year period. Your monthly plan will start then."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep current plan</AlertDialogCancel>
          <AlertDialogAction disabled={disabled} onClick={onConfirm}>Confirm switch</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
