import { appConfig } from "@/app.config";
import { publicPageMetadata } from "@/lib/seo";
import { PolicyTemplate } from "../_components/policy-template";

export const metadata = publicPageMetadata({
  title: "Terms of Service",
  description: `The terms for using ${appConfig.appName}, provided by ${appConfig.companyName}.`,
  path: "/terms",
});

export default function TermsPage() {
  return <PolicyTemplate title="Terms of Service" description="Replace this template with your application’s terms of service before publishing." />;
}
