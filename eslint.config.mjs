import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";
import { plugin as shadcn } from "@shadcn/lint";

// Wide-event logging: Convex functions use the builders in
// convex/lib/functions.ts and components use the hooks in lib/convex.ts.
const loggingPaths = [{
  name: "convex/react",
  importNames: ["useMutation", "useAction"],
  message: "Use useMutation/useAction from @/lib/convex so calls carry a logging flow.",
}];
const loggingPatterns = [{
  group: ["**/_generated/server"],
  importNames: ["query", "mutation", "action", "internalQuery", "internalMutation", "internalAction", "httpAction"],
  message: "Register functions with the builders in convex/lib/functions.ts so they emit wide events.",
}];
const convexRuntime = { group: ["next", "next/*", "@/*"], message: "Convex bundles this file, so it cannot depend on the Next.js runtime." };

export default defineConfig([
  ...nextVitals,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx,mts}"],
  })),
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { shadcn },
    // Add chosen shadcn rules here. Installing the plugin enables no rules.
    rules: {
      "shadcn/no-restyle": "error",
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-inline-styles": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/require-static-classes": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  // A later block replaces no-restricted-imports entirely, so blocks that
  // narrow `files` repeat every restriction that still applies there.
  {
    files: ["**/*.{ts,tsx,mts}"],
    rules: { "no-restricted-imports": ["error", { paths: loggingPaths, patterns: loggingPatterns }] },
  },
  {
    files: ["convex/**/*.ts", "app.config.ts"],
    rules: { "no-restricted-imports": ["error", { paths: loggingPaths, patterns: [...loggingPatterns, convexRuntime] }] },
  },
  {
    // The modules that wrap the raw builders and hooks.
    files: ["convex/lib/functions.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [convexRuntime] }] },
  },
  {
    // Generated images render with Satori, which reads inline styles and plain img
    // elements, not stylesheets or next/image.
    files: ["app/**/{opengraph-image,twitter-image,icon,apple-icon}{,[0-9]}.tsx"],
    rules: { "shadcn/no-inline-styles": "off", "@next/next/no-img-element": "off" },
  },
  {
    files: ["lib/convex.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores(["convex/_generated/**", "components/ui/**"]),
]);
