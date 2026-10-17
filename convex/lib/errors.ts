import { ConvexError } from "convex/values";

// Codes carried by user-facing ConvexErrors. The Next app imports this module
// too, so a renamed or misspelled code fails type checking on both sides.
export type ErrorCode =
  | "ACCOUNT_OPERATION_PENDING"
  | "ACCOUNT_UNAVAILABLE"
  | "BILLING_CONFIGURATION_REQUIRED"
  | "BILLING_OPERATION_PENDING"
  | "BILLING_REQUEST_FAILED"
  | "CUSTOMER_IDENTITY_CONFLICT"
  | "CUSTOMER_NOT_FOUND"
  | "DELETION_PENDING"
  | "EXPORT_TOO_LARGE"
  | "FEATURE_UNAVAILABLE"
  | "INVALID_NAME"
  | "INVALID_NOTE_BODY"
  | "INVALID_NOTE_TITLE"
  | "INVALID_RETURN_URL"
  | "LEGAL_ACCEPTANCE_REQUIRED"
  | "NOTE_NOT_FOUND"
  | "PAID_ACCESS_REQUIRED"
  | "PROVISIONING_FAILED"
  | "PROVISIONING_REQUIRED"
  | "RATE_LIMITED"
  | "RECOVERY_UNAVAILABLE"
  | "SUBSCRIPTION_REACTIVATION_REQUIRED"
  | "SUBSCRIPTION_UNAVAILABLE"
  | "UNAUTHENTICATED"
  | "USE_SUBSCRIPTION_MANAGEMENT"
  | "WITHDRAWAL_PERIOD_ENDED"
  | "WITHDRAWAL_UNAVAILABLE";

// `retryAfter` is the milliseconds until a RATE_LIMITED call may succeed.
export function appError(code: ErrorCode, details: { retryAfter?: number } = {}) {
  return new ConvexError({ code, ...details });
}

// Use on the client to branch on a specific failure from a Convex call.
export function hasErrorCode(error: unknown, code: ErrorCode) {
  return error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    error.data.code === code;
}

// Milliseconds until a rejected RATE_LIMITED call may succeed, or null when
// the error is something else.
export function retryAfter(error: unknown) {
  if (!hasErrorCode(error, "RATE_LIMITED")) return null;
  const value = (error as ConvexError<{ retryAfter?: number }>).data.retryAfter;
  return typeof value === "number" ? value : 0;
}
