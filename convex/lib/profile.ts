import type { Doc } from "../_generated/dataModel";

// Legacy names remain readable until a profile is saved or synced.
export function getDisplayName(user: Pick<Doc<"users">, "displayName" | "firstName" | "lastName">) {
  return user.displayName ?? ([user.firstName, user.lastName].map(name => name?.trim()).filter(Boolean).join(" ") || undefined);
}
