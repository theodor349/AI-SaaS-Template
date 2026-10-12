import { PolicyTemplate } from "../_components/policy-template";
import { CookiePreferencesButton } from "../_components/cookie-preferences-button";

export default function CookiesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PolicyTemplate title="Cookie Policy" description="Replace this template with a cookie policy describing the cookies used by your application before publishing." />
      <div><CookiePreferencesButton /></div>
    </div>
  );
}
