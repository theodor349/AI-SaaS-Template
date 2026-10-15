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
  | "INVALID_RETURN_URL"
  | "LEGAL_ACCEPTANCE_REQUIRED"
  | "PAID_ACCESS_REQUIRED"
  | "PROVISIONING_FAILED"
  | "PROVISIONING_REQUIRED"
  | "RECOVERY_UNAVAILABLE"
  | "SUBSCRIPTION_REACTIVATION_REQUIRED"
  | "SUBSCRIPTION_UNAVAILABLE"
  | "UNAUTHENTICATED"
  | "USE_SUBSCRIPTION_MANAGEMENT";

export function appError(code: ErrorCode) {
  return new ConvexError({ code });
}

// Use on the client to branch on a specific failure from a Convex call.
export function hasErrorCode(error: unknown, code: ErrorCode) {
  return error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    error.data.code === code;
}
