import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireUser } from "./lib/billing";

// Names belong to the application after the first edit; email remains Clerk-owned.
export function normalizeName(value: string) {
  const name = value.trim();
  if (name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name)) throw new ConvexError({ code: "INVALID_NAME" });
  return name || undefined;
}
export const save = mutation({
  args: { firstName: v.string(), lastName: v.string() }, returns: v.null(),
  handler: async (ctx, { firstName, lastName }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch("users", user._id, { firstName: normalizeName(firstName), lastName: normalizeName(lastName), profileEdited: true });
    return null;
  },
});
