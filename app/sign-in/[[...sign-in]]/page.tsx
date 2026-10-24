import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { BackLink } from "@/components/layout/back-link";
import { maintenanceMode } from "@/lib/maintenance";
import { noIndex } from "@/lib/seo";
import { MaintenanceNotice } from "../../_components/maintenance-notice";

export const metadata: Metadata = { title: "Sign in", robots: noIndex };

export default function SignInPage() {
  if (maintenanceMode) return <MaintenanceNotice />;
  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/" label="Home" />
      <div className="flex justify-center">
        <SignIn />
      </div>
    </div>
  );
}
