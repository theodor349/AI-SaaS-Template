import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("expire webhook delivery history", { hours: 6 }, internal.webhooks.prune, {});
export default crons;
