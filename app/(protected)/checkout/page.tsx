import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PaymentRedirect } from "./_components/payment-redirect";

export const metadata: Metadata = { title: "Checkout — AI SaaS Template" };

// The only entry point that starts checkout from a URL, e.g. after sign-up.
export default async function CheckoutPage({ searchParams }: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const { plan } = await searchParams;
  if (plan !== "monthly" && plan !== "yearly" && plan !== "lifetime") redirect("/#pricing");

  return (
    <div className="mx-auto max-w-lg py-16">
      <PaymentRedirect plan={plan} />
    </div>
  );
}
