import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    passWithNoTests: true,
    environment: "edge-runtime",
    // `build:vercel` runs these tests with NODE_ENV=production, which loads React's production build without `act`.
    env: { NODE_ENV: "test" },
    include: ["app/**/*.test.ts", "app/**/*.test.tsx", "components/**/*.test.tsx", "convex/**/*.test.ts", "lib/**/*.test.ts", "proxy.test.ts"],
  },
});
