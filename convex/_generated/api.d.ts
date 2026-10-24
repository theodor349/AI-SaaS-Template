/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account_clerk from "../account/clerk.js";
import type * as account_clerkApi from "../account/clerkApi.js";
import type * as account_clerkWebhooks from "../account/clerkWebhooks.js";
import type * as account_dataExport from "../account/dataExport.js";
import type * as account_dataExportFiles from "../account/dataExportFiles.js";
import type * as account_lifecycle from "../account/lifecycle.js";
import type * as account_profile from "../account/profile.js";
import type * as account_users from "../account/users.js";
import type * as billing_account from "../billing/account.js";
import type * as billing_catalog from "../billing/catalog.js";
import type * as billing_entitlement from "../billing/entitlement.js";
import type * as billing_lib from "../billing/lib.js";
import type * as billing_plans from "../billing/plans.js";
import type * as billing_polar from "../billing/polar.js";
import type * as billing_polarWebhook from "../billing/polarWebhook.js";
import type * as billing_state from "../billing/state.js";
import type * as billing_withdrawalPeriod from "../billing/withdrawalPeriod.js";
import type * as billing_withdrawals from "../billing/withdrawals.js";
import type * as crons from "../crons.js";
import type * as featureFlags from "../featureFlags.js";
import type * as http from "../http.js";
import type * as lib_appEnv from "../lib/appEnv.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_dataExport from "../lib/dataExport.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_featureFlags from "../lib/featureFlags.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_log from "../lib/log.js";
import type * as lib_profile from "../lib/profile.js";
import type * as lib_retry from "../lib/retry.js";
import type * as lib_users from "../lib/users.js";
import type * as notes_notes from "../notes/notes.js";
import type * as notes_validation from "../notes/validation.js";
import type * as rateLimits from "../rateLimits.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "account/clerk": typeof account_clerk;
  "account/clerkApi": typeof account_clerkApi;
  "account/clerkWebhooks": typeof account_clerkWebhooks;
  "account/dataExport": typeof account_dataExport;
  "account/dataExportFiles": typeof account_dataExportFiles;
  "account/lifecycle": typeof account_lifecycle;
  "account/profile": typeof account_profile;
  "account/users": typeof account_users;
  "billing/account": typeof billing_account;
  "billing/catalog": typeof billing_catalog;
  "billing/entitlement": typeof billing_entitlement;
  "billing/lib": typeof billing_lib;
  "billing/plans": typeof billing_plans;
  "billing/polar": typeof billing_polar;
  "billing/polarWebhook": typeof billing_polarWebhook;
  "billing/state": typeof billing_state;
  "billing/withdrawalPeriod": typeof billing_withdrawalPeriod;
  "billing/withdrawals": typeof billing_withdrawals;
  crons: typeof crons;
  featureFlags: typeof featureFlags;
  http: typeof http;
  "lib/appEnv": typeof lib_appEnv;
  "lib/auth": typeof lib_auth;
  "lib/dataExport": typeof lib_dataExport;
  "lib/email": typeof lib_email;
  "lib/errors": typeof lib_errors;
  "lib/featureFlags": typeof lib_featureFlags;
  "lib/functions": typeof lib_functions;
  "lib/log": typeof lib_log;
  "lib/profile": typeof lib_profile;
  "lib/retry": typeof lib_retry;
  "lib/users": typeof lib_users;
  "notes/notes": typeof notes_notes;
  "notes/validation": typeof notes_validation;
  rateLimits: typeof rateLimits;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
