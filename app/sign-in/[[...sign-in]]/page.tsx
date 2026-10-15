import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = { title: "Sign in", robots: NOINDEX };

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <SignIn />
    </main>
  );
}
