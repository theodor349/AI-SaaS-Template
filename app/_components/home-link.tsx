"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUTHENTICATED_DESTINATION } from "@/lib/auth";

// Leads home, or to the signed-in destination once Clerk knows the visitor is signed in.
// It never waits for auth: the home link works while Clerk loads.
export function HomeLink({ variant = "default" }: { variant?: "default" | "outline" }) {
  const { isSignedIn } = useAuth();
  const [href, label] = isSignedIn ? [AUTHENTICATED_DESTINATION, "Go to dashboard"] : ["/", "Back to home"];
  return (
    <Button asChild size="lg" variant={variant}>
      <Link href={href}><ArrowLeft aria-hidden="true" /> {label}</Link>
    </Button>
  );
}
