import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { BackLink } from "@/components/layout/back-link";
import { Link } from "@/components/typography/link";
import { isBillingModel } from "@/convex/billing/plans";
import { noIndex } from "@/lib/seo";
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
  const plan = chosenPlan((await searchParams).redirect_url);
  return (
    <main className="flex min-h-screen flex-col gap-6">
      {plan ? <BackLink href="/#pricing" label="Plans" /> : <BackLink href="/" label="Home" />}
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        {plan && <div className="w-full max-w-100"><SelectedPlan plan={plan} /></div>}
        {/* Creating an account records acceptance of the current terms, so this
            stays above the form, where it is read before signing up. */}
        <p className="w-full max-w-100 text-center text-xs/relaxed text-muted-foreground">
          By creating an account, you agree to the <Link href="/terms">Terms of Service</Link> and
          confirm you’ve read the <Link href="/privacy">Privacy Policy</Link>.
        </p>
        <SignUp />
      </div>
    </main>
  );
}
