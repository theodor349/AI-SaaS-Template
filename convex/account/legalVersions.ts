// The versions of the documents users accept. Each must equal the `version` in
// that document's front matter (content/legal); a unit test checks they match.
// Bump a version only for a material change: every signed-in user is asked to
// accept again. Shared by Convex and the Next app, so keep it free of imports.
export const legalVersions = { terms: 1, privacy: 1 };

export function hasAcceptedCurrent(acceptance: { terms: number; privacy: number } | undefined) {
  return acceptance?.terms === legalVersions.terms && acceptance.privacy === legalVersions.privacy;
}
