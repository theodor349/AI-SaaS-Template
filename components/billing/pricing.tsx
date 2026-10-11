"use client";

import NextLink from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const labels = { monthly: "Monthly", yearly: "Yearly", lifetime: "Lifetime" };
function formatPrice(amount: number, currency: string) {
  const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
  return formatter.format(amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
}
export function Pricing() {
  const products = useQuery(api.billing.products);
  if (products === undefined) return <p role="status">Loading paid plans…</p>;
  if (!products.length) return <p role="alert">Paid plans are being configured. Please check back soon.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {products.map(product => (
        <Card key={product.model}>
          <CardHeader><CardTitle><h2>{labels[product.model]}</h2></CardTitle></CardHeader>
          <CardContent><div className="flex flex-col gap-4">
          <p className="text-2xl font-semibold">
            {formatPrice(product.amount, product.currency)}
            <span className="text-sm font-normal">{product.model === "monthly" ? " / month" : product.model === "yearly" ? " / year" : " once"}</span>
          </p>
          <p className="text-sm text-muted-foreground">{product.taxBehavior === "inclusive" ? "Tax included" : product.taxBehavior === "exclusive" ? "Tax added at checkout" : "Final tax calculated at checkout"}</p>
          <p>Full Pro access{product.model === "lifetime" ? " for the life of the product." : ". Cancel any time."}</p>
          </div></CardContent>
          <CardFooter><Button asChild><NextLink href={`/billing?plan=${product.model}`} prefetch={false}>Choose {labels[product.model].toLowerCase()}</NextLink></Button></CardFooter>
        </Card>
      ))}
    </div>
  );
}
