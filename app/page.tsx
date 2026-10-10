"use client";

import { Button } from "@/components/ui/button";
import { Authenticated, Unauthenticated } from "convex/react";
import { SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { StickyHeader } from "@/components/layout/sticky-header";

export default function Home() {
  return (
    <>
      <StickyHeader className="px-4 py-2">
        <div className="flex justify-between items-center">
          AI SaaS Template
          <div className="flex gap-4">
            <Authenticated>
              <UserButton />
            </Authenticated>
            <Unauthenticated>
              <SignInButton mode="modal">
                <Button variant="ghost">Sign in</Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button>Sign up</Button>
              </SignUpButton>
            </Unauthenticated>
          </div>
        </div>
      </StickyHeader>
      <main className="container max-w-2xl flex flex-col gap-8">
        <h1 className="text-4xl font-extrabold my-8 text-center">
          AI SaaS Template
        </h1>
        <Authenticated>
          <p>You’re signed in.</p>
        </Authenticated>
        <Unauthenticated>
          <p>Sign in to get started.</p>
        </Unauthenticated>
      </main>
    </>
  );
}
