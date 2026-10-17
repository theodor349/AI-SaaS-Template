import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BackLink } from "@/components/layout/back-link";
import { isBillingModel } from "@/convex/billing/plans";
import { PaymentRedirect } from "./_components/payment-redirect";

export const metadata: Metadata = { title: "Checkout" };

// The only entry point that starts checkout from a URL, e.g. after sign-up.
export default async function CheckoutPage({ searchParams }: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const { plan } = await searchParams;
  if (!isBillingModel(plan)) redirect("/#pricing");

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 pb-16">
      <BackLink href="/billing" label="Billing" />
      <PaymentRedirect plan={plan} />
    </div>
  );
}
