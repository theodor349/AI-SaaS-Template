import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { BackLink } from "@/components/layout/back-link";
import { noIndex } from "@/lib/seo";

export const metadata: Metadata = { title: "Sign up", robots: noIndex };

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen flex-col gap-6">
      <BackLink href="/" label="Home" />
      <div className="flex flex-1 items-center justify-center">
        <SignUp />
      </div>
    </main>
  );
}
