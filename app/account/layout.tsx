import { auth } from "@clerk/nextjs/server";
import type { ReactNode } from "react";
import { AuthBoundary } from "@/components/auth/auth-boundary";
import { AccountControls } from "@/components/auth/account-controls";

export default async function AccountLayout({
  children,
}: {
  children: ReactNode;
}) {
  await auth.protect();

  return (
    <main className="container mx-auto max-w-3xl px-4 py-8">
      <AccountControls />
      {/* Each component guards its queries and renders its own pending state. */}
      <AuthBoundary renderWhilePending>{children}</AuthBoundary>
    </main>
  );
}
