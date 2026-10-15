import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { noIndex } from "@/lib/seo";

export const metadata: Metadata = { title: "Sign up", robots: noIndex };

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <SignUp />
    </main>
  );
}
