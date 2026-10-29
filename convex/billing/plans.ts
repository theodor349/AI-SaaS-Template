import { v, type Infer } from "convex/values";
import { appConfig } from "../../app.config";

// Shared by Convex functions and the Next app, so keep this module free of
// server-only imports such as `_generated/server`.

// Whether the app sells plans, from app.config.ts. When it doesn't, every
// active user has paid access and the billing functions refuse with
// BILLING_DISABLED. Check it at boundaries, not inside billing internals.
export const billingEnabled = appConfig.billing;

const monthly = v.literal("monthly");
const yearly = v.literal("yearly");
const lifetime = v.literal("lifetime");

export const recurringModel = v.union(monthly, yearly);
export const billingModel = v.union(monthly, yearly, lifetime);
export type RecurringModel = Infer<typeof recurringModel>;
export type BillingModel = Infer<typeof billingModel>;

export const billingModels = billingModel.members.map((member) => member.value);
const recurringModels = recurringModel.members.map((member) => member.value);

export function isBillingModel(value: unknown): value is BillingModel {
  return billingModels.some((model) => model === value);
}

export function isRecurringModel(value: unknown): value is RecurringModel {
  return recurringModels.some((model) => model === value);
}

export const planLabels: Record<BillingModel, string> = {
  monthly: "Monthly Pro",
  yearly: "Yearly Pro",
  lifetime: "Lifetime Pro",
};
