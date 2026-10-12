import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PaymentRedirect } from "./_components/payment-redirect";

export const metadata: Metadata = { title: "Checkout — AI SaaS Template" };

export default async function CheckoutPage({ searchParams }: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  await auth.protect();
  const { plan } = await searchParams;
  if (plan !== "monthly" && plan !== "yearly" && plan !== "lifetime") redirect("/#pricing");

  return (
    <div className="mx-auto max-w-lg py-16">
      <PaymentRedirect plan={plan} />
    </div>
  );
}
