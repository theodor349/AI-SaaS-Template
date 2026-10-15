import type { Metadata } from "next";
import { appConfig } from "@/app.config";
import { PolicyTemplate } from "../_components/policy-template";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The terms for using ${appConfig.appName}, provided by ${appConfig.companyName}.`,
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <PolicyTemplate title="Terms of Service" description="Replace this template with your application’s terms of service before publishing." />;
}
