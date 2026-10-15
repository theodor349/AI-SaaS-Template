import { appConfig } from "@/app.config";
import { publicPageMetadata } from "@/lib/seo";
import { PolicyTemplate } from "../_components/policy-template";

export const metadata = publicPageMetadata({
  title: "Privacy Policy",
  description: `How ${appConfig.companyName} collects, uses, and protects personal data in ${appConfig.appName}.`,
  path: "/privacy",
});

export default function PrivacyPage() {
  return <PolicyTemplate title="Privacy Policy" description="Replace this template with your application’s privacy policy before publishing." />;
}
