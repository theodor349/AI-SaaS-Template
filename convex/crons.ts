import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("expire webhook delivery history", { hours: 6 }, internal.webhooks.prune, {});
crons.interval("reconcile billing and retry cleanup", { minutes: 1 }, internal.billing.state.sweep, {});
crons.interval("refresh paid product catalog", { hours: 6 }, internal.billing.polar.syncCatalog, {});
crons.interval("retry account cleanup", { minutes: 1 }, internal.account.lifecycle.sweep, {});
crons.interval("retry withdrawal refunds", { minutes: 1 }, internal.billing.withdrawals.sweep, {});
export default crons;
