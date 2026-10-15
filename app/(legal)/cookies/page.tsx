import { appConfig } from "@/app.config";
import { publicPageMetadata } from "@/lib/seo";
import { PolicyTemplate } from "../_components/policy-template";
import { CookiePreferencesButton } from "../_components/cookie-preferences-button";
import { CookieTable } from "./_components/cookie-table";

export const metadata = publicPageMetadata({
  title: "Cookie Policy",
  description: `The cookies ${appConfig.appName} uses and how to change your cookie preferences.`,
  path: "/cookies",
});

export default function CookiesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PolicyTemplate title="Cookie Policy" description="Replace this template with a cookie policy describing the cookies used by your application before publishing." />
      <CookieTable />
      <div><CookiePreferencesButton /></div>
    </div>
  );
}
