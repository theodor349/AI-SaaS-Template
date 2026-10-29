import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { billingEnabled } from "./billing/plans";

const crons = cronJobs();
crons.interval("expire webhook delivery history", { hours: 6 }, internal.webhooks.prune, {});
crons.interval("retry account cleanup", { minutes: 1 }, internal.account.lifecycle.sweep, {});
// An app that doesn't sell plans has no billing rows to sweep and no Polar
// catalog to read, so these jobs aren't registered at all.
if (billingEnabled) {
  crons.interval("reconcile billing and retry cleanup", { minutes: 1 }, internal.billing.state.sweep, {});
  crons.interval("refresh paid product catalog", { hours: 6 }, internal.billing.polar.syncCatalog, {});
  crons.interval("retry withdrawal refunds", { minutes: 1 }, internal.billing.withdrawals.sweep, {});
}
export default crons;
