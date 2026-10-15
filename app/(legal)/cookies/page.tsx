import { LegalDocument, legalMetadata } from "../_components/legal-document";
import { CookiePreferencesButton } from "../_components/cookie-preferences-button";

export const metadata = legalMetadata("cookies");

export default function CookiesPage() {
  return (
    <LegalDocument slug="cookies">
      <div><CookiePreferencesButton /></div>
    </LegalDocument>
  );
}
