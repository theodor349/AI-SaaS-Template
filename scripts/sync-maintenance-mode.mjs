import { execFileSync } from "node:child_process";

// Run by `pnpm build:vercel` after `convex deploy`, so the Convex deployment starts or
// stops refusing public writes as the frontend built with the same MAINTENANCE_MODE is
// published. next.config.js has already failed the build for values other than 1 or unset.
const args = process.env.MAINTENANCE_MODE === "1"
  ? ["env", "set", "MAINTENANCE_MODE", "1"]
  : ["env", "remove", "MAINTENANCE_MODE"];
execFileSync("convex", args, { stdio: "inherit" });
