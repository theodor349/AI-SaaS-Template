/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountLifecycle from "../accountLifecycle.js";
import type * as billing from "../billing.js";
import type * as billingState from "../billingState.js";
import type * as clerkWebhooks from "../clerkWebhooks.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_appEnv from "../lib/appEnv.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_billing from "../lib/billing.js";
import type * as lib_billingModel from "../lib/billingModel.js";
import type * as lib_clerk from "../lib/clerk.js";
import type * as lib_clerkApi from "../lib/clerkApi.js";
import type * as lib_entitlement from "../lib/entitlement.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_polarWebhook from "../lib/polarWebhook.js";
import type * as lib_profile from "../lib/profile.js";
import type * as lib_retry from "../lib/retry.js";
import type * as lib_users from "../lib/users.js";
import type * as polar from "../polar.js";
import type * as profile from "../profile.js";
import type * as users from "../users.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountLifecycle: typeof accountLifecycle;
  billing: typeof billing;
  billingState: typeof billingState;
  clerkWebhooks: typeof clerkWebhooks;
  crons: typeof crons;
  http: typeof http;
  "lib/appEnv": typeof lib_appEnv;
  "lib/auth": typeof lib_auth;
  "lib/billing": typeof lib_billing;
  "lib/billingModel": typeof lib_billingModel;
  "lib/clerk": typeof lib_clerk;
  "lib/clerkApi": typeof lib_clerkApi;
  "lib/entitlement": typeof lib_entitlement;
  "lib/errors": typeof lib_errors;
  "lib/polarWebhook": typeof lib_polarWebhook;
  "lib/profile": typeof lib_profile;
  "lib/retry": typeof lib_retry;
  "lib/users": typeof lib_users;
  polar: typeof polar;
  profile: typeof profile;
  users: typeof users;
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

export declare const components: {};
