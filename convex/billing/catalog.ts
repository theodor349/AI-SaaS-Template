import { v } from "convex/values";
import { internalMutation, query } from "../lib/functions";
import schema from "../schema";
import { requireBilling } from "./lib";
import { billingModel } from "./plans";

export const products = query({
  args: {},
  returns: v.array(v.object({
    model: billingModel,
    name: v.string(),
    amount: v.number(),
    currency: v.string(),
    taxBehavior: v.string(),
  })),
  handler: async (ctx) => {
    requireBilling();
    const rows = await ctx.db.query("billingProducts").take(3);
    return rows.map(({ model, name, amount, currency, taxBehavior }) => ({
      model,
      name,
      amount,
      currency,
      taxBehavior,
    }));
  },
});

export const saveProduct = internalMutation({
  args: schema.tables.billingProducts.validator.fields,
  returns: v.null(),
  handler: async (ctx, product) => {
    const existing = await ctx.db.query("billingProducts")
      .withIndex("by_model", (q) => q.eq("model", product.model))
      .unique();
    if (existing) {
      await ctx.db.patch("billingProducts", existing._id, product);
    } else {
      await ctx.db.insert("billingProducts", product);
    }
    return null;
  },
});
