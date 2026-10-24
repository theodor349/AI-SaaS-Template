import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { isBillingModel } from "@/convex/billing/plans";
import { maintenanceMode } from "@/lib/maintenance";
import { noIndex } from "@/lib/seo";
import { MaintenanceNotice } from "../../_components/maintenance-notice";
import { SelectedPlan } from "./_components/selected-plan";

export const metadata: Metadata = { title: "Sign up", robots: noIndex };

// Pricing sends visitors here with `redirect_url=/checkout?plan=<plan>`.
function chosenPlan(redirectUrl: string | string[] | undefined) {
  if (typeof redirectUrl !== "string") return null;
  try {
    const url = new URL(redirectUrl, "https://app.invalid");
    const plan = url.searchParams.get("plan");
    return url.pathname === "/checkout" && isBillingModel(plan) ? plan : null;
  } catch {
    return null;
  }
}

export default async function SignUpPage({ searchParams }: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  if (maintenanceMode) return <MaintenanceNotice />;
  const plan = chosenPlan((await searchParams).redirect_url);
  return (
    <main className="flex min-h-screen flex-col gap-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        {plan && <div className="w-full max-w-100"><SelectedPlan plan={plan} /></div>}
        <SignUp />
      </div>
    </main>
  );
}
