import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
  },
});
