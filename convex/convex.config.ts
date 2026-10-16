import resend from "@convex-dev/resend/convex.config";
import { defineApp } from "convex/server";
import { appEnv } from "./lib/appEnv";

const app = defineApp({ env: appEnv });
app.use(resend);
export default app;
