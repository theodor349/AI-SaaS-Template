"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { planLabels, type BillingModel } from "@/convex/billing/plans";
import { formatPrice, intervals } from "@/components/billing/pricing";
import { taxDescription } from "@/lib/billing/tax";
import { ContentSkeleton } from "@/components/loading/content-skeleton";
import { Link } from "@/components/typography/link";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// The plan a visitor chose before signing up. Checkout opens for it once the
// account exists.
export function SelectedPlan({ plan }: { plan: BillingModel }) {
  const products = useQuery(api.billing.catalog.products);
  const product = products?.find((item) => item.model === plan);
  // Placeholder text reserves the loaded line's width.
  let price = `$0.00${intervals[plan]} · Tax included`;
  if (product) price = `${formatPrice(product.amount, product.currency)}${intervals[plan]} · ${taxDescription(product.taxBehavior)}`;

  return (
    <Card size="sm" aria-label="Selected plan">
      <CardHeader>
        <CardTitle><h2>{planLabels[plan]}</h2></CardTitle>
        <CardDescription>
          <ContentSkeleton loading={products === undefined}>
            {(products === undefined || product) && <p>{price}</p>}
          </ContentSkeleton>
          <p>Create your account, then pay securely with Polar.</p>
        </CardDescription>
        <CardAction><Link href="/#pricing">Change plan</Link></CardAction>
      </CardHeader>
    </Card>
  );
}
