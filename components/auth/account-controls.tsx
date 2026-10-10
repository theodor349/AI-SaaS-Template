"use client";
import { SignOutButton, useAuth } from "@clerk/nextjs";
import NextLink from "next/link";
import { Button } from "@/components/ui/button";

// Keep the control shell mounted while auth and account data settle.
export function AccountControls() {
  const { isLoaded, isSignedIn } = useAuth();
  return <nav aria-label="Account controls" className="mb-6 flex items-center justify-end gap-3">
    <Button asChild variant="ghost"><NextLink href="/account" prefetch={false}>Account</NextLink></Button>
    <Button asChild variant="ghost"><NextLink href="/billing" prefetch={false}>Billing</NextLink></Button>
    <SignOutButton><Button variant="outline" disabled={!isLoaded || !isSignedIn}>Sign out</Button></SignOutButton>
  </nav>;
}
