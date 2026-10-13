import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireUser } from "./lib/billing";

// The display name belongs to the application after the first edit; email remains Clerk-owned.
export function normalizeName(value: string) {
  const name = value.trim();
  if (name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name)) throw new ConvexError({ code: "INVALID_NAME" });
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
