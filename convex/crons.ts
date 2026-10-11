import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("expire webhook delivery history", { hours: 6 }, internal.webhooks.prune, {});
crons.interval("reconcile billing and retry cleanup", { minutes: 1 }, internal.billingState.sweep, {});
crons.interval("refresh paid product catalog", { hours: 6 }, internal.polar.syncCatalog, {});
crons.interval("retry account cleanup", { minutes: 1 }, internal.accountLifecycle.sweep, {});
export default crons;
