import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { BackLink } from "@/components/layout/back-link";
import { noIndex } from "@/lib/seo";

export const metadata: Metadata = { title: "Sign in", robots: noIndex };

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col gap-6">
      <BackLink href="/" label="Home" />
      <div className="flex flex-1 items-center justify-center">
        <SignIn />
      </div>
    </main>
  );
}
