import { Suspense } from "react";
import { BillingControls } from "./_components/billing-controls";

export default function BillingPage() {
  return <Suspense fallback={<p role="status">Loading billing…</p>}><BillingControls /></Suspense>;
}
