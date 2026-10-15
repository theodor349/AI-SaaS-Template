import { v } from "convex/values";
import { exportOne, exportTime } from "./lib/dataExport";
import { appError } from "./lib/errors";
import { mutation } from "./lib/functions";
import { getDisplayName } from "./lib/profile";
import { requireUser } from "./lib/users";

// The display name belongs to the application after the first edit; email remains Clerk-owned.
export function normalizeName(value: string) {
  const name = value.trim();
  if (name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name)) throw appError("INVALID_NAME");
  return name || undefined;
}
export const save = mutation({
  args: { displayName: v.string() }, returns: v.null(),
  handler: async (ctx, { displayName }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch("users", user._id, { displayName: normalizeName(displayName), firstName: undefined, lastName: undefined, profileEdited: true });
    return null;
  },
});

// Data export section. Sign-in identifiers and sync timestamps stay internal.
export const profileExport = {
  account: exportOne(
    v.object({ email: v.union(v.string(), v.null()), displayName: v.union(v.string(), v.null()), createdAt: v.string() }),
    async (_ctx, owner) => ({ email: owner.email ?? null, displayName: getDisplayName(owner) ?? null, createdAt: exportTime(owner._creationTime) }),
  ),
};
