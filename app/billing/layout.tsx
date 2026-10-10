import { auth } from "@clerk/nextjs/server";
import type { ReactNode } from "react";
import { AuthBoundary } from "@/components/auth/auth-boundary";

export default async function BillingLayout({ children }: { children: ReactNode }) {
  await auth.protect();
  return <main className="container mx-auto px-4 max-w-3xl py-8"><AuthBoundary>{children}</AuthBoundary></main>;
}
