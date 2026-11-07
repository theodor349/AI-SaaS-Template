import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { billingEnabled } from "@/convex/billing/plans";
import { PaymentRedirect } from "./_components/payment-redirect";

export const metadata: Metadata = { title: "Checkout" };

// The only entry point that starts checkout from a URL, e.g. after sign-up.
export default function CheckoutPage() {
  if (!billingEnabled) notFound();

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 pb-16">
      <PaymentRedirect />
    </div>
  );
}
