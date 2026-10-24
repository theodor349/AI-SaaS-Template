import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { maintenanceMode } from "@/lib/maintenance";
import { noIndex } from "@/lib/seo";
import { MaintenanceNotice } from "../../_components/maintenance-notice";

export const metadata: Metadata = { title: "Sign in", robots: noIndex };

export default function SignInPage() {
  if (maintenanceMode) return <MaintenanceNotice />;
  return (
    <main className="flex min-h-screen flex-col gap-6">
      <div className="flex flex-1 items-center justify-center">
        <SignIn />
      </div>
    </main>
  );
}
