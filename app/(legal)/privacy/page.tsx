import type { Metadata } from "next";
import { appConfig } from "@/app.config";
import { PolicyTemplate } from "../_components/policy-template";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${appConfig.companyName} collects, uses, and protects personal data in ${appConfig.appName}.`,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <PolicyTemplate title="Privacy Policy" description="Replace this template with your application’s privacy policy before publishing." />;
}
