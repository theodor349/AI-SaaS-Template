import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = { title: "Sign up", robots: NOINDEX };

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <SignUp />
    </main>
  );
}
