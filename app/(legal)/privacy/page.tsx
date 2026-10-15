import { LegalDocument, legalMetadata } from "../_components/legal-document";

export const metadata = legalMetadata("privacy");

export default function PrivacyPage() {
  return <LegalDocument slug="privacy" />;
}
