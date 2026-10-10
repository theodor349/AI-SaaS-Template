"use client";

import { Button } from "@/components/ui/button";
import {
  useConvexAuth,
  useMutation,
  useQuery,
} from "convex/react";
import { api } from "@/convex/_generated/api";
import { Code } from "@/components/typography/code";
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
      <main className="container max-w-2xl flex flex-col gap-8">
        <h1 className="text-4xl font-extrabold my-8 text-center">
          Convex + Next.js + Clerk Auth
        </h1>
        <AuthBoundary signedOut={<p>Click one of the buttons in the top right corner to sign in.</p>}>
          <SignedInContent />
        </AuthBoundary>
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
  const { viewer, numbers } =
    useQuery(api.myFunctions.listNumbers, {
      count: 10,
    }) ?? {};
  const addNumber = useMutation(api.myFunctions.addNumber);

  if (viewer === undefined || numbers === undefined) {
    return <AuthPending message="Loading the public demo…" />;
  }

  return (
    <>
      <p>Welcome {viewer ?? "N/A"}!</p>
      <p>This is a public demo: all visitors share the same numbers.</p>
      <p>
        Click the button below and open this page in another window - this data
        is persisted in the Convex cloud database!
      </p>
      <p>
        <Button
          onClick={() => {
            void addNumber({ value: Math.floor(Math.random() * 10) });
          }}
        >
          Add a random number
        </Button>
      </p>
      <p>
        Numbers:{" "}
        {numbers?.length === 0
          ? "Click the button!"
          : numbers?.join(", ") ?? "..."}
      </p>
      <p>
        Edit <Code>convex/myFunctions.ts</Code> to change your backend
      </p>
      <p>
        Edit <Code>app/page.tsx</Code> to change your frontend
      </p>
      <p>
        Check out{" "}
        <Link target="_blank" href="https://docs.convex.dev/home">
          Convex docs
        </Link>
      </p>
      <p>
        To build a full page layout copy one of the included{" "}
        <Link target="_blank" href="/layouts">
          layouts
        </Link>
      </p>
    </>
  );
}
