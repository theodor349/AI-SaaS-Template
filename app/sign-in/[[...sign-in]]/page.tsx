import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { noIndex } from "@/lib/seo";

export const metadata: Metadata = { title: "Sign in", robots: noIndex };

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <SignIn />
    </main>
  );
}
