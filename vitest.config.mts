import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    passWithNoTests: true,
    environment: "edge-runtime",
    include: ["app/**/*.test.ts", "convex/**/*.test.ts", "lib/**/*.test.ts", "proxy.test.ts"],
  },
});
