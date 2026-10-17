import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import resend from "@convex-dev/resend/convex.config";
import { defineApp } from "convex/server";
import { appEnv } from "./lib/appEnv";

const app = defineApp({ env: appEnv });
app.use(rateLimiter);
app.use(resend);
export default app;
