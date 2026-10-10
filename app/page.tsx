"use client";

import { Button } from "@/components/ui/button";
import {
  useConvexAuth,
  useQuery,
} from "convex/react";
import { api } from "@/convex/_generated/api";
import { Pricing } from "@/components/billing/pricing";
import { Link } from "@/components/typography/link";
import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import { StickyHeader } from "@/components/layout/sticky-header";
import { AuthBoundary, AuthPending } from "@/components/auth/auth-boundary";
import { AUTHENTICATED_DESTINATION } from "@/lib/auth";

export default function Home() {
  return (
    <>
      <StickyHeader className="px-4 py-2">
        <div className="flex justify-between items-center">
          Convex + Next.js + Clerk
          <SignInAndSignUpButtons />
        </div>
      </StickyHeader>
      <main className="container mx-auto px-4 max-w-2xl flex flex-col gap-8">
        <h1 className="text-4xl font-extrabold my-8 text-center">
          Pro access for every application user
        </h1>
        <AuthBoundary signedOut={<p>Click one of the buttons in the top right corner to sign in.</p>}>
          <SignedInContent />
        </AuthBoundary>
        <Pricing />
      </main>
    </>
  );
}

function SignInAndSignUpButtons() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading, isRefreshing } = useConvexAuth();
  if (!isLoaded) return null;
  return (
    <div className="flex gap-4">
      {isSignedIn ? (
        <>
          {isAuthenticated && !isLoading && !isRefreshing && (
            // Keep protected redirects out of the prefetch cache across sessions.
            <Link href={AUTHENTICATED_DESTINATION} prefetch={false}>
              Open application
            </Link>
          )}
          <UserButton />
        </>
      ) : (
        <>
          <SignInButton mode="modal">
            <Button variant="ghost">Sign in</Button>
          </SignInButton>
          <SignUpButton mode="modal">
            <Button>Sign up</Button>
          </SignUpButton>
        </>
      )}
    </div>
  );
}

function SignedInContent() {
  const identity = useQuery(api.auth.currentIdentity);
  if (!identity) return <AuthPending message="Loading your account…" />;
  return <p>Welcome {identity.name ?? "to your account"}!</p>;
}
